CREATE TABLE server_operations (
    server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    document TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE metric_history (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    sampled_at INTEGER NOT NULL,
    document TEXT NOT NULL,
    PRIMARY KEY(server_id, sampled_at)
);
CREATE INDEX metric_history_time ON metric_history(sampled_at);
CREATE TABLE scheduled_exports (
    export_id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
);
CREATE INDEX scheduled_exports_server ON scheduled_exports(server_id, created_at);
