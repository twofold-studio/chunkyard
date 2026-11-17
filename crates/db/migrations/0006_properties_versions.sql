CREATE TABLE server_properties_versions (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version > 0),
    etag TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('import','edit','restore')),
    created_at TEXT NOT NULL,
    PRIMARY KEY(server_id, version)
);
CREATE TABLE server_properties_state (
    server_id TEXT PRIMARY KEY NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    desired_version INTEGER,
    applied_version INTEGER,
    runtime_identity TEXT,
    FOREIGN KEY(server_id, desired_version) REFERENCES server_properties_versions(server_id, version),
    FOREIGN KEY(server_id, applied_version) REFERENCES server_properties_versions(server_id, version)
);
