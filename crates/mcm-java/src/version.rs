use crate::JavaError;

/// Supports both legacy Java 1.8 notation and modern/early-access versions.
pub fn major_version(version: &str) -> Result<u16, JavaError> {
    let version = version.strip_prefix("1.").unwrap_or(version);
    let digits: String = version.chars().take_while(char::is_ascii_digit).collect();
    let major = digits
        .parse::<u16>()
        .map_err(|_| JavaError::InvalidVersion)?;
    if major == 0 {
        return Err(JavaError::InvalidVersion);
    }
    Ok(major)
}

pub(crate) fn version_key(version: &str) -> Vec<u32> {
    version
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|s| s.parse().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_legacy_modern_and_early_access_versions() -> Result<(), JavaError> {
        for (input, expected) in [("1.8.0_432", 8), ("17.0.9", 17), ("21", 21), ("25-ea", 25)] {
            assert_eq!(major_version(input)?, expected);
        }
        Ok(())
    }
    #[test]
    fn invalid_versions_return_errors() {
        for value in ["", "java", "0", "65536", "-21"] {
            assert!(major_version(value).is_err());
        }
    }
}
