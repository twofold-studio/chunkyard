CREATE TABLE java_runtimes (
    path TEXT PRIMARY KEY NOT NULL,
    id TEXT NOT NULL UNIQUE,
    managed INTEGER NOT NULL CHECK (managed IN (0, 1)),
    document TEXT NOT NULL CHECK (json_valid(document))
);
