use super::*;

impl ServerManager {
    pub(super) async fn set_resources_inner(
        &self,
        id: &str,
        request: ResourceUpdate,
    ) -> Result<ServerView, ServerError> {
        validation::resources(request.memory_min_mb, request.memory_max_mb, request.cpus)?;
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let mut server = self.local_record(id).await?;
        if self.runtime.status(&server).await?.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        self.runtime.remove(&server).await?;
        self.repo.set_resources(&server.id, &request).await?;
        server.memory_min_mb = request.memory_min_mb;
        server.memory_max_mb = request.memory_max_mb;
        server.cpus = request.cpus;
        self.view(server).await
    }
    pub(super) async fn network_inner(&self, id: &str) -> Result<NetworkSettings, ServerError> {
        self.runtime.network(&self.local_record(id).await?).await
    }
    pub(super) async fn set_network_inner(
        &self,
        id: &str,
        request: NetworkUpdate,
    ) -> Result<ServerView, ServerError> {
        if request.port == 0 {
            return Err(ServerError::Invalid("port must be between 1 and 65535"));
        }
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let mut server = self.local_record(id).await?;
        if self.runtime.status(&server).await?.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        self.runtime.remove(&server).await?;
        self.repo
            .set_network(&server.id, request.port, request.publish_ip)
            .await?;
        server.port = request.port;
        server.publish_ip = request.publish_ip;
        self.view(server).await
    }
}
