use crate::AuthError;
use argon2::{
    Algorithm, Argon2, Params, PasswordHash, PasswordHasher, PasswordVerifier, Version,
    password_hash::SaltString,
};
use rand::rngs::OsRng;
use std::{collections::HashSet, sync::LazyLock};
static COMMON_PASSWORDS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    include_str!("../resources/common-passwords.txt")
        .lines()
        .map(str::to_ascii_lowercase)
        .collect()
});

pub(crate) fn validate(password: &str) -> Result<(), AuthError> {
    let length = password.chars().count();
    if !(10..=256).contains(&length) || password.len() > 1024 {
        return Err(AuthError::Password);
    }
    let lower = password.to_ascii_lowercase();
    if [
        "password123",
        "password1234",
        "1234567890",
        "qwerty12345",
        "letmein1234",
        "minecraft123",
    ]
    .contains(&lower.as_str())
        || COMMON_PASSWORDS.contains(&lower)
        || password.chars().all(|c| password.starts_with(c))
    {
        return Err(AuthError::Password);
    }
    Ok(())
}
fn argon() -> Result<Argon2<'static>, AuthError> {
    let params = Params::new(19456, 2, 1, None).map_err(|_| AuthError::Hash)?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}
pub(crate) fn hash(password: &str) -> Result<String, AuthError> {
    argon()?
        .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
        .map(|p| p.to_string())
        .map_err(|_| AuthError::Hash)
}
pub(crate) fn verify(password: &str, hash: &str) -> Result<bool, AuthError> {
    let hash = PasswordHash::new(hash).map_err(|_| AuthError::Hash)?;
    Ok(argon()?.verify_password(password.as_bytes(), &hash).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_common_repeated_short_and_oversized_passwords() {
        for password in ["1234567890", "PASSWORD123", "zzzzzzzzzz", "short"] {
            assert!(validate(password).is_err());
        }
        assert!(validate(&"x".repeat(257)).is_err());
        assert!(validate("correct horse battery staple").is_ok());
        assert!(COMMON_PASSWORDS.len() >= 9000);
    }
    #[test]
    fn hashes_are_salted_and_verification_rejects_wrong_passwords() -> Result<(), AuthError> {
        let first = hash("correct horse battery staple")?;
        let second = hash("correct horse battery staple")?;
        assert_ne!(first, second);
        assert!(verify("correct horse battery staple", &first)?);
        assert!(!verify("incorrect", &first)?);
        Ok(())
    }
}
