use async_trait::async_trait;
use mcm_core::server::*;
use std::{collections::HashMap, path::PathBuf, sync::Mutex};

#[derive(Default)]
pub struct FakeRuntime {
    pub starts: std::sync::atomic::AtomicUsize,
    pub crash_on_start: std::sync::atomic::AtomicBool,
    crashed: Mutex<std::collections::HashSet<String>>,
    pub metrics_streams: std::sync::atomic::AtomicUsize,
    pub active_metrics_streams: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    pub metrics_sampling: Mutex<Option<MetricsSampling>>,
    states: Mutex<HashMap<String, ServerState>>,
    commands: Mutex<Vec<String>>,
}
struct MetricsLease(std::sync::Arc<std::sync::atomic::AtomicUsize>);
impl Drop for MetricsLease {
    fn drop(&mut self) {
        self.0.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}
impl FakeRuntime {
    pub fn crash(&self, id: &str) -> Result<(), ServerError> {
        self.states
            .lock()
            .map_err(|_| ServerError::Busy)?
            .insert(id.into(), ServerState::Stopped);
        self.crashed
            .lock()
            .map_err(|_| ServerError::Busy)?
            .insert(id.into());
        Ok(())
    }
    fn set(&self, server: &Server, state: ServerState) -> Result<(), ServerError> {
        self.states
            .lock()
            .map_err(|_| ServerError::Busy)?
            .insert(server.id.clone(), state);
        Ok(())
    }
}
#[async_trait]
impl ServerRuntime for FakeRuntime {
    async fn stream_metrics_at(
        &self,
        server: &Server,
        sampling: MetricsSampling,
    ) -> Result<MetricsStream, ServerError> {
        *self
            .metrics_sampling
            .lock()
            .map_err(|_| ServerError::Busy)? = Some(sampling);
        self.stream_metrics(server).await
    }
    async fn stream_metrics(&self, server: &Server) -> Result<MetricsStream, ServerError> {
        if self.status(server).await?.state != ServerState::Running {
            return Err(ServerError::NotRunning);
        }
        self.metrics_streams
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let sample = self.metrics(server).await?;
        self.active_metrics_streams
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let lease = MetricsLease(self.active_metrics_streams.clone());
        Ok(Box::pin(futures_util::stream::unfold(
            (sample, 0u32, lease),
            |(mut sample, sequence, lease)| async move {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                sample.sampled_at = format!(
                    "2026-01-01T00:00:{:02}.{:03}Z",
                    sequence / 10,
                    sequence % 10 * 100
                );
                Some((Ok(sample.clone()), (sample, sequence + 1, lease)))
            },
        )))
    }
    async fn remove(&self, server: &Server) -> Result<(), ServerError> {
        if self.status(server).await?.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        self.states
            .lock()
            .map_err(|_| ServerError::Busy)?
            .remove(&server.id);
        Ok(())
    }
    async fn info(&self) -> DockerInfo {
        DockerInfo {
            available: true,
            version: Some("fixture".into()),
            reason: None,
            capacity: Some(HostCapacity {
                logical_cpus: Some(4),
                memory_total_bytes: Some(24 * 1024 * 1024 * 1024),
                architecture: Some("aarch64".into()),
                operating_system: Some("fixture".into()),
            }),
        }
    }
    async fn metrics(&self, server: &Server) -> Result<ServerMetrics, ServerError> {
        let status = self.status(server).await?;
        let running = status.state == ServerState::Running;
        Ok(ServerMetrics {
            server_id: server.id.clone(),
            status,
            sampled_at: "2026-01-01T00:00:00Z".into(),
            started_at: running.then(|| "2025-12-31T23:59:00Z".into()),
            uptime_seconds: running.then_some(60),
            cpu_percent: running.then_some(12.5),
            memory_usage_bytes: running.then_some(256_000_000),
            memory_working_set_bytes: running.then_some(200_000_000),
            memory_limit_bytes: running.then_some(512_000_000),
            network_rx_bytes: None,
            network_tx_bytes: None,
            block_read_bytes: None,
            block_write_bytes: None,
            pids: None,
        })
    }
    async fn status(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        let state = self
            .states
            .lock()
            .map_err(|_| ServerError::Busy)?
            .get(&server.id)
            .cloned()
            .unwrap_or(ServerState::Stopped);
        Ok(RuntimeStatus {
            state,
            container_id: self
                .states
                .lock()
                .map_err(|_| ServerError::Busy)?
                .contains_key(&server.id)
                .then(|| format!("fixture-{}", server.id)),
            exit_code: self
                .crashed
                .lock()
                .map_err(|_| ServerError::Busy)?
                .contains(&server.id)
                .then_some(1),
            oom_killed: false,
        })
    }
    async fn start(&self, server: &Server, _: PathBuf) -> Result<RuntimeStatus, ServerError> {
        if self.status(server).await?.state == ServerState::Running {
            return Err(ServerError::AlreadyRunning);
        }
        self.starts
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self
            .crash_on_start
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            self.crash(&server.id)?;
        } else {
            self.crashed
                .lock()
                .map_err(|_| ServerError::Busy)?
                .remove(&server.id);
            self.set(server, ServerState::Running)?;
        }
        self.status(server).await
    }
    async fn stop(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        self.crashed
            .lock()
            .map_err(|_| ServerError::Busy)?
            .remove(&server.id);
        self.set(server, ServerState::Stopped)?;
        self.status(server).await
    }
    async fn kill(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        self.stop(server).await
    }
    async fn logs(&self, _: &Server, _: u32) -> Result<Vec<ConsoleLine>, ServerError> {
        Ok(vec![ConsoleLine {
            stream: "stdout".into(),
            text: "Done (0.1s)!".into(),
        }])
    }
    async fn command(&self, server: &Server, line: &str) -> Result<(), ServerError> {
        if self.status(server).await?.state != ServerState::Running {
            return Err(ServerError::NotRunning);
        }
        self.commands
            .lock()
            .map_err(|_| ServerError::Busy)?
            .push(line.into());
        Ok(())
    }
}
