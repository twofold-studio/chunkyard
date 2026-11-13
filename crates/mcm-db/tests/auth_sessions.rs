use mcm_core::auth::{AuthRepo, NewSession, User};
use mcm_db::{Database, SqliteAuthRepo};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
fn owner(id: &str) -> User {
    User {
        id: id.into(),
        email: id.into(),
        role: "owner".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
    }
}
fn session(id: &str, now: i64) -> NewSession {
    NewSession {
        hash: format!("hash-{id}"),
        public_id: format!("session-{id}"),
        user_id: id.into(),
        now,
    }
}

#[tokio::test]
async fn only_one_concurrent_setup_can_claim_the_instance() -> Result {
    let directory = tempfile::tempdir()?;
    let db = Database::open(&directory.path().join("test.db")).await?;
    let repo = SqliteAuthRepo::new(&db);
    let user1 = owner("first");
    let user2 = owner("second");
    let session1 = session("first", 1000);
    let session2 = session("second", 1000);
    let (first, second) = tokio::join!(
        repo.create_owner(&user1, "hash", &session1),
        repo.create_owner(&user2, "hash", &session2)
    );
    assert_ne!(first?, second?);
    assert!(!repo.setup_required().await?);
    db.close().await;
    Ok(())
}
#[tokio::test]
async fn sessions_enforce_idle_absolute_expiry_and_revocation() -> Result {
    let directory = tempfile::tempdir()?;
    let db = Database::open(&directory.path().join("test.db")).await?;
    let repo = SqliteAuthRepo::new(&db);
    repo.create_owner(&owner("owner"), "hash", &session("owner", 1000))
        .await?;
    assert!(repo.session("hash-owner", 1001).await?.is_some());
    repo.delete_session("hash-owner").await?;
    assert!(repo.session("hash-owner", 1002).await?.is_none());
    repo.create_session(&session("owner", 1000)).await?;
    assert!(
        repo.session("hash-owner", 1000 + 7 * 86400)
            .await?
            .is_none()
    );
    repo.delete_session("hash-owner").await?;
    repo.create_session(&session("owner", 1000)).await?;
    for day in 1..30 {
        assert!(
            repo.session("hash-owner", 1000 + day * 86400)
                .await?
                .is_some()
        );
    }
    assert!(
        repo.session("hash-owner", 1000 + 30 * 86400)
            .await?
            .is_none()
    );
    db.close().await;
    Ok(())
}
