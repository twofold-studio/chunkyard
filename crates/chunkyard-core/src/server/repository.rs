use super::*;
use crate::repository::RepositoryError;
use async_trait::async_trait;
use std::net::IpAddr;
#[async_trait]
pub trait ServerRepo: Send + Sync {
    async fn save(&self, server: &Server) -> Result<(), RepositoryError>;
    async fn set_launch(
        &self,
        id: &str,
        profile: Option<&crate::software::LaunchProfile>,
        image: &str,
        auto_java: bool,
    ) -> Result<(), RepositoryError>;
    async fn set_resources(
        &self,
        id: &str,
        request: &ResourceUpdate,
    ) -> Result<(), RepositoryError>;
    async fn set_network(
        &self,
        id: &str,
        port: u16,
        publish_ip: Option<IpAddr>,
    ) -> Result<(), RepositoryError>;
    async fn delete(&self, id: &str) -> Result<(), RepositoryError>;
    async fn insert(&self, server: &Server) -> Result<(), ServerError>;
    async fn set_eula(&self, id: &str, accepted: bool) -> Result<(), RepositoryError>;
    async fn set_installation(
        &self,
        id: &str,
        launch: &crate::software::Launch,
        image: &str,
    ) -> Result<(), RepositoryError>;
    async fn get(&self, id: &str) -> Result<Option<Server>, RepositoryError>;
    async fn list(&self) -> Result<Vec<Server>, RepositoryError>;
}
