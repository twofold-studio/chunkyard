CREATE TABLE servers (
    id TEXT PRIMARY KEY NOT NULL,
    port INTEGER NOT NULL UNIQUE CHECK(port BETWEEN 1 AND 65535),
    document TEXT NOT NULL CHECK(json_valid(document))
);
