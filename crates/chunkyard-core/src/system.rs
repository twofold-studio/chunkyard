use async_trait::async_trait;
#[async_trait]
pub trait HealthCheck: Send + Sync {
    async fn healthy(&self) -> bool;
}
