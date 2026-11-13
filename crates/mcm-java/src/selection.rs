use crate::version::version_key;
use mcm_core::java::{JavaRequirement, JavaRuntime};

/// Prefer exact managed, exact system, then the lowest newer major if permitted.
/// Patch/build components are compared numerically, not lexicographically.
pub fn select(runtimes: &[JavaRuntime], requirement: JavaRequirement) -> Option<&JavaRuntime> {
    runtimes
        .iter()
        .filter(|r| {
            r.major == requirement.major || (!requirement.strict && r.major > requirement.major)
        })
        .min_by(|a, b| {
            let rank = |r: &JavaRuntime| (r.major != requirement.major, r.major, !r.managed);
            rank(a)
                .cmp(&rank(b))
                .then_with(|| version_key(&b.full_version).cmp(&version_key(&a.full_version)))
                .then_with(|| a.path.cmp(&b.path))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mcm_core::java::JavaRuntimeId;
    use uuid::Uuid;
    fn runtime(major: u16, version: &str, managed: bool) -> JavaRuntime {
        JavaRuntime {
            id: JavaRuntimeId(Uuid::nil()),
            vendor: "test".into(),
            major,
            full_version: version.into(),
            os: "linux".into(),
            arch: "x64".into(),
            path: version.into(),
            managed,
            sha256: None,
        }
    }
    #[test]
    fn selects_numeric_patch_and_managed_priority() {
        let runtimes = [
            runtime(21, "21.0.9", true),
            runtime(21, "21.0.10", true),
            runtime(21, "21.0.11", false),
        ];
        assert_eq!(
            select(
                &runtimes,
                JavaRequirement {
                    major: 21,
                    strict: true
                }
            )
            .map(|r| r.full_version.as_str()),
            Some("21.0.10")
        );
    }
    #[test]
    fn strict_requirements_reject_newer_java() {
        assert!(
            select(
                &[runtime(21, "21", true)],
                JavaRequirement {
                    major: 8,
                    strict: true
                }
            )
            .is_none()
        );
    }
    #[test]
    fn non_strict_chooses_lowest_newer_major() {
        let runtimes = [runtime(25, "25", true), runtime(17, "17", false)];
        assert_eq!(
            select(
                &runtimes,
                JavaRequirement {
                    major: 8,
                    strict: false
                }
            )
            .map(|r| r.major),
            Some(17)
        );
    }
}
