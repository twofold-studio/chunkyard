use crate::{
    AuthError, SetupToken, password,
    throttle::Throttle,
    token::{random_token, token_hash, unix_time},
};
use chunkyard_core::auth::{Actor, ApiKey, AuthRepo, NewApiKey, NewSession, Session, User};
use std::{
    net::IpAddr,
    sync::{Arc, Mutex},
};
use tokio::sync::Semaphore;
use uuid::Uuid;

pub struct IssuedSession {
    pub token: String,
    pub session: Session,
}
pub struct AuthService {
    repo: Arc<dyn AuthRepo>,
    setup: Option<SetupToken>,
    dummy_hash: String,
    workers: Arc<Semaphore>,
    throttle: Mutex<Throttle>,
}
impl AuthService {
    pub async fn issue_api_key(
        &self,
        name: &str,
        user_id: Option<&str>,
    ) -> Result<(ApiKey, String), AuthError> {
        let name = name.trim();
        if name.is_empty() || name.len() > 80 || name.chars().any(char::is_control) {
            return Err(AuthError::KeyName);
        }
        let token = format!("cyk_{}", random_token());
        let key = ApiKey {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            prefix: token[..12].into(),
            created_at: rfc3339(unix_time()),
            last_used_at: None,
        };
        if !self
            .repo
            .create_api_key(&NewApiKey {
                key: key.clone(),
                hash: token_hash(&token),
                user_id: user_id.map(str::to_owned),
            })
            .await?
        {
            return Err(AuthError::KeyLimit);
        }
        Ok((key, token))
    }
    pub async fn api_keys(&self) -> Result<Vec<ApiKey>, AuthError> {
        Ok(self.repo.api_keys().await?)
    }
    pub async fn revoke_api_key(&self, id: &str) -> Result<(), AuthError> {
        Ok(self.repo.revoke_api_key(id).await?)
    }
    pub async fn authenticate_api_key(
        &self,
        token: &str,
        trusted: bool,
    ) -> Result<Actor, AuthError> {
        if token.len() != 47
            || !token.starts_with("cyk_")
            || !token[4..]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(AuthError::Required);
        }
        self.repo
            .api_key(&token_hash(token), unix_time(), trusted)
            .await?
            .map(|identity| Actor::ApiKey(identity.user))
            .ok_or(AuthError::Required)
    }
    pub async fn new(
        repo: Arc<dyn AuthRepo>,
        setup: Option<SetupToken>,
    ) -> Result<Self, AuthError> {
        let dummy_hash = tokio::task::spawn_blocking(|| password::hash(&random_token()))
            .await
            .map_err(|_| AuthError::Worker)??;
        Ok(Self {
            repo,
            setup,
            dummy_hash,
            workers: Arc::new(Semaphore::new(4)),
            throttle: Mutex::new(Throttle::default()),
        })
    }
    pub async fn setup_required(&self) -> Result<bool, AuthError> {
        Ok(self.repo.setup_required().await?)
    }
    /// Check the bootstrap token without creating a user/session or consuming it.
    /// Account creation always performs this check again.
    pub async fn verify_setup_token(&self, token: &str) -> Result<(), AuthError> {
        if !self.setup_required().await? {
            return Err(AuthError::AlreadySetup);
        }
        if !self
            .setup
            .as_ref()
            .is_some_and(|setup| setup.matches(token))
        {
            return Err(AuthError::InvalidSetupToken);
        }
        Ok(())
    }
    pub async fn setup(
        &self,
        token: &str,
        email: &str,
        password: String,
    ) -> Result<IssuedSession, AuthError> {
        self.verify_setup_token(token).await?;
        let email = email.trim().to_ascii_lowercase();
        if email.len() > 254 || email.parse::<email_address::EmailAddress>().is_err() {
            return Err(AuthError::Email);
        }
        password::validate(&password)?;
        let permit = self
            .workers
            .clone()
            .try_acquire_owned()
            .map_err(|_| AuthError::Throttled)?;
        let hash = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            password::hash(&password)
        })
        .await
        .map_err(|_| AuthError::Worker)??;
        let now = unix_time();
        let user = User {
            id: Uuid::new_v4().to_string(),
            email,
            role: "owner".into(),
            created_at: rfc3339(now),
        };
        let (token, record) = new_session(&user.id, now);
        if !self.repo.create_owner(&user, &hash, &record).await? {
            return Err(AuthError::AlreadySetup);
        }
        if let Some(setup) = &self.setup {
            setup.remove_file().await?;
        }
        Ok(IssuedSession {
            token,
            session: Session {
                user,
                public_id: record.public_id,
            },
        })
    }
    pub async fn login(
        &self,
        email: &str,
        password: String,
        ip: IpAddr,
    ) -> Result<IssuedSession, AuthError> {
        if !self.setup_required().await? {
            if email.len() > 254
                || email.trim().parse::<email_address::EmailAddress>().is_err()
                || password.len() > 1024
            {
                return Err(AuthError::InvalidCredentials);
            }
            let email = email.trim().to_ascii_lowercase();
            self.throttle
                .lock()
                .map_err(|_| AuthError::Worker)?
                .check(ip, &email, unix_time())?;
            let credentials = self.repo.credentials(&email).await?;
            let hash = credentials
                .as_ref()
                .map_or(&self.dummy_hash, |c| &c.password_hash)
                .clone();
            let permit = self
                .workers
                .clone()
                .try_acquire_owned()
                .map_err(|_| AuthError::Throttled)?;
            let verified = tokio::task::spawn_blocking(move || {
                let _permit = permit;
                password::verify(&password, &hash)
            })
            .await
            .map_err(|_| AuthError::Worker)??;
            if !verified || credentials.is_none() {
                self.throttle
                    .lock()
                    .map_err(|_| AuthError::Worker)?
                    .failure(ip, &email, unix_time());
                return Err(AuthError::InvalidCredentials);
            }
            self.throttle
                .lock()
                .map_err(|_| AuthError::Worker)?
                .success(ip, &email);
            let credentials = credentials.ok_or(AuthError::InvalidCredentials)?;
            let (token, record) = new_session(&credentials.user.id, unix_time());
            self.repo.create_session(&record).await?;
            Ok(IssuedSession {
                token,
                session: Session {
                    user: credentials.user,
                    public_id: record.public_id,
                },
            })
        } else {
            Err(AuthError::SetupRequired)
        }
    }
    pub async fn authenticate(&self, token: &str) -> Result<Session, AuthError> {
        if token.len() != 43 {
            return Err(AuthError::Required);
        }
        self.repo
            .session(&token_hash(token), unix_time())
            .await?
            .ok_or(AuthError::Required)
    }
    pub async fn logout(&self, token: &str) -> Result<(), AuthError> {
        Ok(self.repo.delete_session(&token_hash(token)).await?)
    }
}
fn new_session(user_id: &str, now: i64) -> (String, NewSession) {
    let token = random_token();
    let record = NewSession {
        hash: token_hash(&token),
        public_id: Uuid::new_v4().to_string(),
        user_id: user_id.into(),
        now,
    };
    (token, record)
}
fn rfc3339(now: i64) -> String {
    // User timestamps are generated from the same clock as session expiry.
    time::OffsetDateTime::from_unix_timestamp(now)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH)
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}
