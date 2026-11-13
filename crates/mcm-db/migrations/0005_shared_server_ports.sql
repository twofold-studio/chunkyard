-- Configured ports may be shared; runtime admission prevents simultaneous use.
CREATE TABLE servers_shared_ports (
    id TEXT PRIMARY KEY NOT NULL,
    port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
    document TEXT NOT NULL CHECK(json_valid(document))
);
INSERT INTO servers_shared_ports(id, port, document) SELECT id, port, document FROM servers;
DROP TABLE servers;
ALTER TABLE servers_shared_ports RENAME TO servers;
CREATE INDEX servers_port ON servers(port);
