use super::DockerRuntime;
use mcm_core::{
    operations::{GameStatus, PlayerIdentity},
    server::{Server, ServerError, ServerState},
};
use serde_json::Value;
use std::{
    net::{IpAddr, SocketAddr},
    time::{Duration, Instant},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

impl DockerRuntime {
    pub(super) async fn game_readiness(&self, server: &Server) -> Result<GameStatus, ServerError> {
        let container = self.inspect(server).await?;
        let started = container
            .as_ref()
            .and_then(|c| c.state.as_ref())
            .and_then(|s| s.started_at.as_deref())
            .and_then(|s| OffsetDateTime::parse(s, &Rfc3339).ok());
        let mut addresses = Vec::new();
        if let Some(networks) = container
            .as_ref()
            .and_then(|c| c.network_settings.as_ref())
            .and_then(|n| n.networks.as_ref())
        {
            for network in networks.values().take(8) {
                if let Some(ip) = network
                    .ip_address
                    .as_deref()
                    .and_then(|s| s.parse::<IpAddr>().ok())
                {
                    addresses.push(SocketAddr::new(ip, 25565));
                }
                // The bridge gateway is the Docker host. Published ports are reachable
                // there when the manager runs on another Docker network.
                if server
                    .publish_ip
                    .unwrap_or(self.config.publish_ip)
                    .is_unspecified()
                    && let Some(ip) = network
                        .gateway
                        .as_deref()
                        .and_then(|s| s.parse::<IpAddr>().ok())
                {
                    addresses.push(SocketAddr::new(ip, server.port));
                }
            }
        }
        let publish = server.publish_ip.unwrap_or(self.config.publish_ip);
        if !publish.is_unspecified()
            && (!publish.is_loopback() || !std::path::Path::new("/.dockerenv").exists())
        {
            addresses.push(SocketAddr::new(publish, server.port));
        }
        let runtime = Self::status_of(container);
        let mut result = GameStatus {
            state: match runtime.state {
                ServerState::Running => "starting",
                ServerState::Paused => "paused",
                ServerState::Unknown => "unknown",
                ServerState::Stopped
                    if runtime.oom_killed || runtime.exit_code.is_some_and(|c| c != 0) =>
                {
                    "failed"
                }
                ServerState::Stopped => "stopped",
            }
            .into(),
            observed_at: OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .map_err(|_| ServerError::Docker)?,
            latency_ms: None,
            online_players: None,
            max_players: None,
            player_sample: vec![],
            version: None,
            connect_address: (!publish.is_unspecified())
                .then(|| SocketAddr::new(publish, server.port).to_string()),
            detail: "Minecraft has not returned a valid status response yet.".into(),
        };
        if runtime.state != ServerState::Running {
            result.detail = if runtime.oom_killed {
                "The container was killed after exceeding its memory limit."
            } else {
                "Minecraft is not running."
            }
            .into();
            return Ok(result);
        }
        let response = tokio::time::timeout(Duration::from_secs(3), async {
            for address in addresses {
                if let Ok(Ok(response)) =
                    tokio::time::timeout(Duration::from_millis(700), ping(address)).await
                {
                    return Some(response);
                }
            }
            None
        })
        .await
        .ok()
        .flatten();
        if let Some((value, latency)) = response {
            result.state = "ready".into();
            result.detail="Minecraft answered a Server List Ping. Player names are only the server's advertised sample.".into();
            result.latency_ms = Some(latency);
            result.online_players = value
                .pointer("/players/online")
                .and_then(Value::as_u64)
                .and_then(|n| u32::try_from(n).ok());
            result.max_players = value
                .pointer("/players/max")
                .and_then(Value::as_u64)
                .and_then(|n| u32::try_from(n).ok());
            result.version = value
                .pointer("/version/name")
                .and_then(Value::as_str)
                .map(|s| s.chars().take(200).collect());
            if let Some(players) = value.pointer("/players/sample").and_then(Value::as_array) {
                for player in players.iter().take(100) {
                    if let (Some(name), Some(id)) = (player["name"].as_str(), player["id"].as_str())
                        && let Ok(id) = uuid::Uuid::parse_str(id)
                    {
                        result.player_sample.push(PlayerIdentity {
                            name: name.chars().take(64).collect(),
                            uuid: id.to_string(),
                        });
                    }
                }
            }
        } else if started.is_some_and(|s| (OffsetDateTime::now_utc() - s).whole_seconds() > 300) {
            result.state = "unreachable".into();
            result.detail="No valid Minecraft status reply. Startup may have stalled, enable-status may be disabled, or networking may block the probe. Check the console.".into();
        }
        Ok(result)
    }
}

fn varint(mut value: u32, out: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 127) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 128;
        }
        out.push(byte);
        if value == 0 {
            break;
        }
    }
}
async fn read_varint(stream: &mut tokio::net::TcpStream) -> std::io::Result<usize> {
    let mut value = 0usize;
    for shift in (0..35).step_by(7) {
        let b = stream.read_u8().await?;
        value |= usize::from(b & 127) << shift;
        if b & 128 == 0 {
            return Ok(value);
        }
    }
    Err(std::io::Error::other("oversized status VarInt"))
}
async fn ping(address: SocketAddr) -> std::io::Result<(Value, u64)> {
    let start = Instant::now();
    let mut stream = tokio::net::TcpStream::connect(address).await?;
    let host = address.ip().to_string();
    let mut handshake = vec![0];
    varint(u32::MAX, &mut handshake);
    varint(host.len() as u32, &mut handshake);
    handshake.extend(host.as_bytes());
    handshake.extend(address.port().to_be_bytes());
    handshake.push(1);
    let mut packet = vec![];
    varint(handshake.len() as u32, &mut packet);
    packet.extend(handshake);
    packet.extend([1, 0]);
    stream.write_all(&packet).await?;
    let length = read_varint(&mut stream).await?;
    if !(3..=65536).contains(&length) {
        return Err(std::io::Error::other("invalid status frame size"));
    }
    let mut response = vec![0; length];
    stream.read_exact(&mut response).await?;
    if response[0] != 0 {
        return Err(std::io::Error::other("invalid status packet"));
    }
    let mut size = 0usize;
    let mut offset = 1;
    loop {
        let b = *response
            .get(offset)
            .ok_or_else(|| std::io::Error::other("truncated status"))?;
        if offset > 5 {
            return Err(std::io::Error::other("oversized status string"));
        }
        size |= usize::from(b & 127) << ((offset - 1) * 7);
        offset += 1;
        if b & 128 == 0 {
            break;
        }
    }
    if size != response.len() - offset {
        return Err(std::io::Error::other("invalid status string size"));
    }
    let value: Value =
        serde_json::from_slice(&response[offset..]).map_err(std::io::Error::other)?;
    if !value.is_object() || !value.get("version").is_some_and(Value::is_object) {
        return Err(std::io::Error::other("invalid Minecraft status"));
    }
    Ok((
        value,
        u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn real_status_handshake_reads_bounded_minecraft_reply()
    -> Result<(), Box<dyn std::error::Error>> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let task = tokio::spawn(async move {
            let (mut client, _) = listener.accept().await?;
            let size = read_varint(&mut client).await?;
            let mut handshake = vec![0; size];
            client.read_exact(&mut handshake).await?;
            assert_eq!(handshake[0], 0);
            assert_eq!(handshake.last(), Some(&1));
            let mut request = [0; 2];
            client.read_exact(&mut request).await?;
            assert_eq!(request, [1, 0]);
            let json=br#"{"version":{"name":"Vanilla fixture","protocol":1},"players":{"online":0,"max":20}}"#;
            let mut data = vec![0];
            varint(json.len() as u32, &mut data);
            data.extend(json);
            let mut frame = vec![];
            varint(data.len() as u32, &mut frame);
            frame.extend(data);
            client.write_all(&frame).await?;
            Ok::<_, std::io::Error>(())
        });
        let (response, _) = ping(address).await?;
        assert_eq!(response["players"]["online"], 0);
        task.await??;
        Ok(())
    }
    #[tokio::test]
    async fn oversized_status_is_rejected_before_allocating_body()
    -> Result<(), Box<dyn std::error::Error>> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let task = tokio::spawn(async move {
            let (mut client, _) = listener.accept().await?;
            let mut buf = [0; 256];
            let _ = client.read(&mut buf).await?;
            client.write_all(&[255, 255, 127]).await?;
            Ok::<_, std::io::Error>(())
        });
        assert!(ping(address).await.is_err());
        task.await??;
        Ok(())
    }
}
