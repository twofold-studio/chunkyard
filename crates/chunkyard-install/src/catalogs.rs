//! Official provider catalogs; never infer compatibility from an arbitrary user pin.
use crate::{
    Installers,
    providers::{release, version_key},
};
use chunkyard_core::software::{SoftwareError, component};
use serde_json::{Value, json};

pub(super) const FABRIC: &str = "https://meta.fabricmc.net/v2/versions";
const FORGE: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
const NEOFORGE: &str =
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
pub(super) const PURPUR: &str = "https://api.purpurmc.org/v2/purpur";

pub(super) fn neo_minecraft(version: &str) -> Option<String> {
    let numbers = version
        .split('-')
        .next()?
        .split('.')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    match numbers.as_slice() {
        [major, minor, patch, _] if *major >= 26 => Some(if *patch == 0 {
            format!("{major}.{minor}")
        } else {
            format!("{major}.{minor}.{patch}")
        }),
        [major, minor, _] if (20..=21).contains(major) => Some(if *minor == 0 {
            format!("1.{major}")
        } else {
            format!("1.{major}.{minor}")
        }),
        _ => None,
    }
}

fn strings(value: &Value) -> Result<Vec<String>, SoftwareError> {
    Ok(value
        .as_array()
        .ok_or(SoftwareError::Upstream)?
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect())
}

pub(super) fn version_items(mut ids: Vec<String>) -> Value {
    ids.retain(|id| release(id));
    ids.sort_by_cached_key(|id| std::cmp::Reverse(version_key(id)));
    ids.dedup();
    json!({"items": ids.into_iter().map(|id| json!({"id":id,"stable":true})).collect::<Vec<_>>()})
}

impl Installers {
    pub(super) async fn extra_versions(&self, kind: &str) -> Result<Value, SoftwareError> {
        let ids = match kind {
            "fabric" => self
                .json(&format!("{FABRIC}/game"))
                .await?
                .as_array()
                .ok_or(SoftwareError::Upstream)?
                .iter()
                .filter(|v| v["stable"] == true)
                .filter_map(|v| v["version"].as_str().map(str::to_owned))
                .collect(),
            "forge" => self
                .json(FORGE)
                .await?
                .as_object()
                .ok_or(SoftwareError::Upstream)?
                .keys()
                .filter(|id| version_key(id) >= vec![1, 12, 2])
                .cloned()
                .collect(),
            "neoforge" => strings(&self.json(NEOFORGE).await?["versions"])?
                .iter()
                .filter_map(|id| neo_minecraft(id))
                .collect(),
            "purpur" => strings(&self.json(PURPUR).await?["versions"])?,
            _ => return Err(SoftwareError::Invalid),
        };
        Ok(version_items(ids))
    }

    pub(super) async fn extra_builds(
        &self,
        kind: &str,
        version: &str,
    ) -> Result<Value, SoftwareError> {
        component(version)?;
        if !release(version) {
            return Err(SoftwareError::Invalid);
        }
        let mut items: Vec<Value> = match kind {
            "fabric" => self
                .json(&format!("{FABRIC}/loader/{version}"))
                .await?
                .as_array()
                .ok_or(SoftwareError::Upstream)?
                .iter()
                .filter_map(|v| {
                    let id = v["loader"]["version"].as_str()?;
                    component(id).ok()?;
                    Some(json!({"id":id,"stable":v["loader"]["stable"] == true}))
                })
                .collect(),
            "forge" => {
                if version_key(version) < vec![1, 12, 2] {
                    return Err(SoftwareError::Invalid);
                }
                let metadata = self.json(FORGE).await?;
                let prefix = format!("{version}-");
                strings(&metadata[version])
                    .map_err(|_| SoftwareError::Invalid)?
                    .iter()
                    .filter_map(|v| v.strip_prefix(&prefix))
                    .filter(|id| component(id).is_ok())
                    .map(|id| json!({"id":id,"stable":!id.contains('-')}))
                    .collect()
            }
            "neoforge" => strings(&self.json(NEOFORGE).await?["versions"])?
                .into_iter()
                .filter(|id| neo_minecraft(id).as_deref() == Some(version))
                .map(|id| json!({"stable":!id.contains('-'),"id":id}))
                .collect(),
            "purpur" => {
                strings(&self.json(&format!("{PURPUR}/{version}")).await?["builds"]["all"])?
                    .into_iter()
                    .filter(|id| {
                        id.parse::<u32>()
                            .is_ok_and(|n| n > 0 && n.to_string() == *id)
                    })
                    .map(|id| json!({"id":id,"stable":true}))
                    .collect()
            }
            _ => return Err(SoftwareError::Invalid),
        };
        items.sort_by_cached_key(|v| {
            std::cmp::Reverse(version_key(v["id"].as_str().unwrap_or_default()))
        });
        Ok(json!({"items":items}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn neoforge_coordinates_map_to_exact_game_releases() {
        for (id, game) in [
            ("20.2.3-beta", "1.20.2"),
            ("21.0.167", "1.21"),
            ("21.1.265", "1.21.1"),
            ("26.1.0.12-beta", "26.1"),
            ("26.1.2.126", "26.1.2"),
        ] {
            assert_eq!(neo_minecraft(id).as_deref(), Some(game));
        }
        assert_eq!(neo_minecraft("0.25w14craftmine.3-beta"), None);
        assert_eq!(neo_minecraft("../21.1.265"), None);
    }
    #[test]
    fn versions_are_natural_sorted_deduplicated_and_release_only() {
        let data = version_items(vec![
            "1.21.9".into(),
            "1.21.11".into(),
            "1.21.9".into(),
            "26.1-rc1".into(),
        ]);
        assert_eq!(
            data["items"],
            json!([{"id":"1.21.11","stable":true},{"id":"1.21.9","stable":true}])
        );
    }
}
