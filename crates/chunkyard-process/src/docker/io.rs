use super::{DockerRuntime, docker_error};
use bollard::{
    container::LogOutput,
    query_parameters::{AttachContainerOptionsBuilder, LogsOptionsBuilder},
};
use chunkyard_core::server::{ConsoleLine, Server, ServerError, ServerRuntime, ServerState};
use futures_util::TryStreamExt;
use tokio::io::AsyncWriteExt;
impl DockerRuntime {
    pub(super) async fn follow_logs(
        &self,
        server: &Server,
        tail: u32,
    ) -> Result<chunkyard_core::server::ConsoleStream, ServerError> {
        use futures_util::{StreamExt, stream};
        let container = self.inspect(server).await?.ok_or(ServerError::NotRunning)?;
        let id = container.id.ok_or(ServerError::Docker)?;
        let options = LogsOptionsBuilder::default()
            .stdout(true)
            .stderr(true)
            .timestamps(true)
            .follow(true)
            .tail(&tail.to_string())
            .build();
        let frames = self.client()?.logs(&id, Some(options));
        let lines = frames
            .map(|frame| {
                let (source, message) = match frame {
                    Ok(LogOutput::StdOut { message }) => ("stdout", message),
                    Ok(LogOutput::StdErr { message }) => ("stderr", message),
                    Ok(_) => return Vec::new(),
                    Err(e) => return vec![Err(docker_error(e))],
                };
                if message.len() > 4 * 1024 * 1024 {
                    return vec![Err(ServerError::Docker)];
                }
                String::from_utf8_lossy(&message)
                    .lines()
                    .take(256)
                    .map(|text| {
                        let mut end = text.len().min(8192);
                        while !text.is_char_boundary(end) {
                            end -= 1;
                        }
                        Ok(ConsoleLine {
                            stream: source.into(),
                            text: text[..end].into(),
                        })
                    })
                    .collect()
            })
            .flat_map(stream::iter);
        Ok(Box::pin(lines))
    }
    pub(super) async fn write_command(
        &self,
        server: &Server,
        line: &str,
    ) -> Result<(), ServerError> {
        if self.status(server).await?.state != ServerState::Running {
            return Err(ServerError::NotRunning);
        }
        let mut attached = self
            .client()?
            .attach_container(
                &self.name(server),
                Some(
                    AttachContainerOptionsBuilder::default()
                        .stdin(true)
                        .stream(true)
                        .build(),
                ),
            )
            .await
            .map_err(docker_error)?;
        attached
            .input
            .write_all(format!("{line}\n").as_bytes())
            .await
            .map_err(|_| ServerError::Docker)?;
        attached
            .input
            .flush()
            .await
            .map_err(|_| ServerError::Docker)?;
        Ok(())
    }
    pub(super) async fn read_logs(
        &self,
        server: &Server,
        tail: u32,
    ) -> Result<Vec<ConsoleLine>, ServerError> {
        if self.inspect(server).await?.is_none() {
            return Ok(Vec::new());
        }
        let client = self.client()?;
        let options = LogsOptionsBuilder::default()
            .stdout(true)
            .stderr(true)
            .timestamps(true)
            .tail(&tail.to_string())
            .build();
        let name = self.name(server);
        let mut stream = client.logs(&name, Some(options));
        let mut lines = Vec::new();
        let mut bytes = 0;
        while let Some(frame) = stream.try_next().await.map_err(docker_error)? {
            let (source, message) = match frame {
                LogOutput::StdOut { message } => ("stdout", message),
                LogOutput::StdErr { message } => ("stderr", message),
                _ => continue,
            };
            bytes += message.len();
            if bytes > 4 * 1024 * 1024 {
                break;
            }
            for text in String::from_utf8_lossy(&message).lines() {
                lines.push(ConsoleLine {
                    stream: source.into(),
                    text: text.into(),
                });
                if lines.len() >= tail as usize {
                    return Ok(lines);
                }
            }
        }
        Ok(lines)
    }
}
