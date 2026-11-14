CREATE INDEX jobs_server_created ON jobs(json_extract(document, '$.serverId'), created_at DESC, id DESC);
CREATE INDEX jobs_active_created ON jobs(created_at DESC, id DESC) WHERE state IN ('queued', 'running');
