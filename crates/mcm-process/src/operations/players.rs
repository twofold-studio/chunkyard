use super::Operations;
use mcm_core::{
    files::{FileError, WriteContent},
    operations::*,
    server::ServerState,
};
use md5::{Digest, Md5};
use serde_json::{Value, json};

fn file(list: &str) -> Result<&'static str, OperationsError> {
    match list {
        "whitelist" => Ok("whitelist.json"),
        "operators" => Ok("ops.json"),
        "bans" => Ok("banned-players.json"),
        _ => Err(OperationsError::Invalid(
            "Select whitelist, operators, or bans.",
        )),
    }
}
fn valid_name(name: &str) -> bool {
    (3..=16).contains(&name.len()) && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
}
fn bool_property(content: &str, key: &str, default: bool) -> bool {
    content
        .lines()
        .filter_map(|line| line.trim().split_once('='))
        .rfind(|(k, _)| k.trim() == key)
        .map(|(_, v)| v.trim() == "true")
        .unwrap_or(default)
}
impl Operations {
    async fn player_file(
        &self,
        id: &str,
        path: &str,
    ) -> Result<(Vec<Value>, Option<String>), OperationsError> {
        match self.files.content(id, path.into()).await {
            Ok(file) => {
                let entries: Vec<Value> =
                    serde_json::from_str(&file.content).map_err(|_| OperationsError::PlayerFile)?;
                if entries.len() > 10000
                    || entries.iter().any(|e| {
                        e["name"].as_str().is_none()
                            || e["uuid"]
                                .as_str()
                                .and_then(|s| uuid::Uuid::parse_str(s).ok())
                                .is_none()
                    })
                {
                    return Err(OperationsError::PlayerFile);
                }
                Ok((entries, Some(file.etag)))
            }
            Err(FileError::NotFound) => Ok((vec![], None)),
            Err(e) => Err(e.into()),
        }
    }
    pub(super) async fn player_lists(&self, id: &str) -> Result<PlayerLists, OperationsError> {
        let server = self.servers.get(id).await?;
        if server.server.archive.is_some() {
            return Err(mcm_core::server::ServerError::Archived.into());
        }
        let properties = self
            .properties
            .properties(id)
            .await
            .map_err(crate::properties::file_error)?;
        let known = match self.files.content(id, "usercache.json".into()).await {
            Ok(file) => serde_json::from_str::<Vec<Value>>(&file.content)
                .ok()
                .unwrap_or_default()
                .into_iter()
                .take(10000)
                .filter_map(|e| {
                    Some(PlayerIdentity {
                        name: e["name"].as_str()?.chars().take(64).collect(),
                        uuid: uuid::Uuid::parse_str(e["uuid"].as_str()?).ok()?.to_string(),
                    })
                })
                .collect(),
            Err(FileError::NotFound) => vec![],
            Err(e) => return Err(e.into()),
        };
        Ok(PlayerLists {
            whitelist: self.player_file(id, "whitelist.json").await?.0,
            operators: self.player_file(id, "ops.json").await?.0,
            bans: self.player_file(id, "banned-players.json").await?.0,
            known_players: known,
            running: server.status.state == ServerState::Running,
            online_mode: bool_property(&properties.content, "online-mode", true),
            whitelist_enabled: bool_property(&properties.content, "white-list", false),
        })
    }
    async fn identity(
        &self,
        change: &PlayerChange,
        lists: &PlayerLists,
    ) -> Result<String, OperationsError> {
        if let Some(id) = &change.uuid {
            return uuid::Uuid::parse_str(id)
                .map(|u| u.to_string())
                .map_err(|_| OperationsError::Identity);
        }
        if let Some(player) = lists
            .known_players
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(&change.name))
        {
            return Ok(player.uuid.clone());
        }
        if !lists.online_mode {
            let digest = Md5::digest(format!("OfflinePlayer:{}", change.name).as_bytes());
            let mut bytes: [u8; 16] = digest.into();
            bytes[6] = (bytes[6] & 15) | 48;
            bytes[8] = (bytes[8] & 63) | 128;
            return Ok(uuid::Uuid::from_bytes(bytes).to_string());
        }
        let mut response = self
            .profile_http
            .get(format!(
                "https://api.mojang.com/users/profiles/minecraft/{}",
                change.name
            ))
            .send()
            .await
            .map_err(|_| OperationsError::Identity)?;
        if !response.status().is_success() || response.content_length().is_some_and(|s| s > 4096) {
            return Err(OperationsError::Identity);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| OperationsError::Identity)?
        {
            if bytes.len() + chunk.len() > 4096 {
                return Err(OperationsError::Identity);
            }
            bytes.extend_from_slice(&chunk);
        }
        let profile: Value =
            serde_json::from_slice(&bytes).map_err(|_| OperationsError::Identity)?;
        uuid::Uuid::parse_str(profile["id"].as_str().ok_or(OperationsError::Identity)?)
            .map(|u| u.to_string())
            .map_err(|_| OperationsError::Identity)
    }
    pub(super) async fn apply_player_change(
        &self,
        id: &str,
        change: PlayerChange,
    ) -> Result<PlayerLists, OperationsError> {
        let path = file(&change.list)?;
        if !valid_name(&change.name)
            || !matches!(change.action.as_str(), "add" | "remove")
            || change.level.is_some_and(|n| !(1..=4).contains(&n))
            || change
                .reason
                .as_ref()
                .is_some_and(|s| s.len() > 256 || s.chars().any(char::is_control))
        {
            return Err(OperationsError::Invalid(
                "Use a valid Minecraft name, add/remove, level 1–4, and a single-line reason up to 256 bytes.",
            ));
        }
        let lists = self.player_lists(id).await?;
        if lists.running {
            if change.list == "operators" && change.level.is_some() {
                return Err(OperationsError::Invalid(
                    "Stop the server to set an explicit operator level. Live op uses the server's configured level.",
                ));
            }
            let command = match (change.list.as_str(), change.action.as_str()) {
                ("whitelist", "add") => format!("whitelist add {}", change.name),
                ("whitelist", "remove") => format!("whitelist remove {}", change.name),
                ("operators", "add") => format!("op {}", change.name),
                ("operators", "remove") => format!("deop {}", change.name),
                ("bans", "add") => format!(
                    "ban {} {}",
                    change.name,
                    change.reason.as_deref().unwrap_or("Banned by server owner")
                ),
                ("bans", "remove") => format!("pardon {}", change.name),
                _ => return Err(OperationsError::PlayerFile),
            };
            self.servers.command(id, &command).await?;
            for _ in 0..40 {
                if let Ok((entries, _)) = self.player_file(id, path).await {
                    let present = entries.iter().any(|e| {
                        e["name"]
                            .as_str()
                            .is_some_and(|n| n.eq_ignore_ascii_case(&change.name))
                    });
                    if present == (change.action == "add") {
                        return self.player_lists(id).await;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            return Err(OperationsError::Invalid(
                "The command was sent, but Minecraft has not confirmed the file update. Check the console before retrying.",
            ));
        }
        let (mut entries, etag) = self.player_file(id, path).await?;
        let existing = entries
            .iter()
            .find(|e| {
                e["name"]
                    .as_str()
                    .is_some_and(|n| n.eq_ignore_ascii_case(&change.name))
            })
            .cloned();
        let identity = if let Some(entry) = existing.as_ref() {
            entry["uuid"]
                .as_str()
                .ok_or(OperationsError::PlayerFile)?
                .to_owned()
        } else if change.action == "remove" {
            return Ok(lists);
        } else {
            self.identity(&change, &lists).await?
        };
        entries.retain(|e| e["uuid"].as_str() != Some(&identity));
        if change.action == "add" {
            let mut entry = existing.unwrap_or_else(|| json!({}));
            entry["uuid"] = json!(identity);
            entry["name"] = json!(change.name);
            match change.list.as_str() {
                "operators" => {
                    entry["level"] = json!(change.level.unwrap_or(4));
                    entry["bypassesPlayerLimit"] = json!(false);
                }
                "bans" => {
                    let now = time::OffsetDateTime::now_utc();
                    entry["created"] = json!(format!(
                        "{:04}-{:02}-{:02} {:02}:{:02}:{:02} +0000",
                        now.year(),
                        u8::from(now.month()),
                        now.day(),
                        now.hour(),
                        now.minute(),
                        now.second()
                    ));
                    entry["source"] = json!("Chunkyard owner");
                    entry["expires"] = json!("forever");
                    entry["reason"] = json!(
                        change
                            .reason
                            .unwrap_or_else(|| "Banned by server owner".into())
                    );
                }
                _ => {}
            }
            entries.push(entry);
        }
        let content =
            serde_json::to_string_pretty(&entries).map_err(|_| OperationsError::PlayerFile)?;
        self.files
            .save(id, path.into(), WriteContent { content, etag })
            .await?;
        self.player_lists(id).await
    }
}
