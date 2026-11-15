# API keys and MCP

The API reference and `GET /api/v1/openapi.json` are public. Server data and mutations remain authenticated.

## Owner API keys

- `GET /api/v1/auth/api-keys` → `{items: ApiKey[]}`.
- `POST /api/v1/auth/api-keys`, `{name: string}` → 201 `{key: ApiKey, token: string}`. The full token is returned only here. Names are 1–80 UTF-8 bytes without control characters; at most 100 keys.
- `DELETE /api/v1/auth/api-keys/{id}` → 204, including an already revoked ID.
- `ApiKey = {id, name, prefix, createdAt, lastUsedAt: string|null}`.

Management requires an owner browser session (or the explicitly configured trusted-network auth-disabled mode), with existing Origin/CSRF protection. API keys cannot list, create or revoke keys. Tokens are random 256-bit bearer credentials, stored only as SHA-256 hashes. Revocation applies to subsequent requests. Last-use timestamps are coalesced to one database update per minute per key.

Send `Authorization: Bearer cyk_…` on REST and MCP requests. Do not put keys in URLs or mix them with session cookies. Valid bearer requests do not need the browser CSRF header; supplied Origin and Host are still checked. Invalid Authorization never falls back to browser/trusted authentication. Keys have full owner access; create a separate key per integration and revoke it when no longer needed. Keys created in auth-disabled mode stop working if authentication is later enabled.

## MCP

`/mcp` provides stateless Streamable HTTP with JSON responses and bearer-key authentication on every request, including when browser authentication is disabled. Clients must support configurable Authorization headers. Browser-only OAuth connector flows are not provided. Tool operations reuse the same services and restrictions as REST, including stopped-only file changes, EULA consent, archive checks and asynchronous jobs. Installing never starts a server or accepts the EULA.

Example Claude Code connection (replace placeholders locally):

```sh
claude mcp add --transport http chunkyard https://YOUR-CHUNKYARD/mcp --header 'Authorization: Bearer YOUR_API_KEY'
```

Treat generated client configuration as a credential file. The manager never puts credentials in tool definitions, results or public documentation.

Codex also supports HTTP MCP with a bearer token sourced from the environment:

```sh
codex mcp add chunkyard --url https://YOUR-CHUNKYARD/mcp --bearer-token-env-var CHUNKYARD_API_KEY
```

Supply `CHUNKYARD_API_KEY` through your normal secret manager when launching Codex. A local `http_headers_helper` can retrieve the credential instead of putting a secret in TOML; see the [official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Restart the client after adding a connection so it can discover the tools.

Available tools: `list_servers`, `create_server`, `get_server`, `get_metrics`, `get_console`, `get_properties`, `write_properties`, `list_files`, `read_file`, `list_backups`, `get_job`, `install_server`, `start_server`, `stop_server`, `restart_server`, and `send_command`. Mutation tools require `confirm: true`. Creation forces EULA acceptance off and never starts an instance. Permanent deletion, credential management and storage configuration are not exposed as MCP tools; owner API keys still have full REST access.

The transport supports MCP protocol versions 2025-03-26, 2025-06-18 and 2025-11-25. It does not retain protocol sessions or provide server-initiated SSE messages; `GET /mcp` returns 405. JSON-RPC notifications return 202. Tool calls are bounded to eight concurrent calls with a 30-second response deadline. If a mutation times out, inspect Activity before retrying.

Implementation follows the [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). The [Claude Code MCP guide](https://code.claude.com/docs/en/mcp) documents HTTP servers and custom authorization headers. Local integration was verified with the official TypeScript MCP SDK 1.32.2: initialize, tool discovery, stopped creation, reads, mutation validation and key revocation. This does not establish OAuth compatibility with claude.ai connectors.
