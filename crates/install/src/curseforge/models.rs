//! Bounded cached project metadata and public display projection.
use serde_json::{Value, json};

pub(crate) fn project_view(project: &Value) -> Value {
    let id = project["id"].as_u64().unwrap_or(0);
    let website = project["links"]["websiteUrl"].as_str().and_then(|value| {
        let url = url::Url::parse(value).ok()?;
        (url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && matches!(
                url.host_str(),
                Some("curseforge.com" | "www.curseforge.com")
            )
            && url.port_or_known_default() == Some(443))
        .then_some(value)
    });
    let logo = logo_source(project).map(|_| format!("/api/v1/modpacks/curseforge/{id}/logo"));
    json!({"id":id,"name":project["name"],"summary":project["summary"],
        "websiteUrl":website,"logoUrl":logo,"downloads":project["downloadCount"]})
}
pub(super) fn logo_source(project: &Value) -> Option<&str> {
    project["logo"]["thumbnailUrl"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| project["logo"]["url"].as_str().filter(|s| !s.is_empty()))
}

// Retain only display/download-policy fields; upstream projects include large file inventories.
pub(super) fn cached_project(project: &Value) -> Value {
    let text = |value: &Value, limit| {
        value
            .as_str()
            .map(|text| text.chars().take(limit).collect::<String>())
    };
    json!({"id":project["id"],"gameId":project["gameId"],"classId":project["classId"],
        "allowModDistribution":project["allowModDistribution"],"downloadCount":project["downloadCount"],
        "name":text(&project["name"],256),"summary":text(&project["summary"],2000),
        "links":{"websiteUrl":text(&project["links"]["websiteUrl"],2048)},
        "logo":{"url":text(&project["logo"]["url"],2048),"thumbnailUrl":text(&project["logo"]["thumbnailUrl"],2048)}})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn display_metadata_uses_local_logos_and_discards_unneeded_or_unsafe_fields() {
        let source = json!({"id":925200,"gameId":432,"classId":4471,"name":"ATM 10",
            "summary":"A pack","downloadCount":123,"allowModDistribution":false,
            "links":{"websiteUrl":"https://evil.test/pack"},
            "logo":{"thumbnailUrl":"","url":"https://media.forgecdn.net/avatars/logo.png"},
            "latestFiles":["large file inventory"]});
        let cached = cached_project(&source);
        assert!(cached.get("latestFiles").is_none());
        assert_eq!(cached["allowModDistribution"], false);
        let view = project_view(&cached);
        assert_eq!(view["logoUrl"], "/api/v1/modpacks/curseforge/925200/logo");
        assert!(view["websiteUrl"].is_null());
        assert_eq!(
            logo_source(&cached),
            Some("https://media.forgecdn.net/avatars/logo.png")
        );
    }
}
