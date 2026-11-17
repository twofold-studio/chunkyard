use chunkyard_core::software::Software;
use serde_json::json;

#[test]
fn standalone_selections_round_trip_and_reject_unsafe_or_missing_pins()
-> Result<(), Box<dyn std::error::Error>> {
    for selection in [
        json!({"type":"purpur","version":"1.21.1"}),
        json!({"type":"fabric","version":"1.21.1","loaderVersion":"0.16.10"}),
        json!({"type":"forge","version":"1.20.1","loaderVersion":"47.4.0"}),
        json!({"type":"neoforge","version":"1.21.1","loaderVersion":"21.1.265"}),
    ] {
        let parsed = serde_json::from_value::<Software>(selection.clone())?;
        assert!(parsed.validate().is_ok());
        let mut expected = selection;
        if expected["type"] == "purpur" {
            expected["build"] = serde_json::Value::Null;
        }
        assert_eq!(serde_json::to_value(parsed)?, expected);
    }
    assert!(
        serde_json::from_value::<Software>(json!({"type":"forge","version":"1.21.1"})).is_err()
    );
    for selection in [
        json!({"type":"purpur","version":"1.21.1","build":"latest"}),
        json!({"type":"neoforge","version":"1.21.1","loaderVersion":"../escape"}),
    ] {
        assert!(
            serde_json::from_value::<Software>(selection)?
                .validate()
                .is_err()
        );
    }
    Ok(())
}
