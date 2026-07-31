# @xr-utilities/h-series-mcp

Model Context Protocol (MCP) server that is the public front door to the
H-Series backends. It exposes each backend's endpoints as MCP tools and
forwards calls to the live HTTPS services:

- H-Index: capability registry (search, listings, register, renew, revoke, risk events, config)
- H-Seal: receipt anchoring and verification
- H-Grant: credential vaults and authorized capability release
- H-Relay: agent message delivery, inbox, heartbeat
- H-Scope: wallet behavior scanning and entity-posture reads
- H-Pact: membership-ring registry (create, admit, config)
- H-Gate: agentic data-egress control (inspect text, config)
- H-Cert: standing and owner-delegation layer (resolve, standing, principals, config)

## What it is

A stateless passthrough. The server holds no database, no wallet, and no
secrets. It maps an inbound MCP tool call to the owning backend, substitutes
path parameters, forwards declared headers (including the caller-supplied
x402 payment envelope), and relays the response. The backends are the
authoritative validators and the source of truth; this server adds a
defense-in-depth check on inbound arguments and does not enforce auth or
payment itself.

Payment is per call where a tool is priced: the caller supplies an x402
payment envelope as `payment_signature`, which the dispatcher forwards as the
`x-payment` header. Tools marked free never carry a payment header. When a
paid tool is called without payment, the request is still forwarded so the
caller receives the real 402 challenge from the backend.

## Audit observability

Every tool call is traced to the shared estate SIEM audit stream, so the H-Index
hub can serve a per-agent view of what transited the MCP front door. On each resolved
call the dispatcher emits one operator-signed `mcp.tool_call` (bucket `activity`)
event; a backend 5xx or a network failure emits `mcp.tool_call_failed`
(`service_failure`) and a non-402 4xx emits `mcp.tool_call_failed`
(`malicious_suspicious`). Each event carries public-safe scalar fields only: `tool`,
`service`, `route`, `status`, `latencyMs`, and a caller-IP fingerprint.

Caller-IP privacy: the raw client IP is NEVER placed on the public audit topic. The
event carries a salted, keyed one-way hash (`ipHash`) and a coarse `/24` / `/48` prefix
(`ipPrefix`); the raw IP appears only in the local stderr op-log. Set
`AUDIT_IP_HASH_SALT` for stable cross-restart correlation of repeat callers.

Anchoring is fail-safe OFF: it activates only when `AUDIT_OPERATOR_ID`,
`AUDIT_OPERATOR_KEY`, and `HCS_AUDIT_TOPIC_ID` are all set. When unset the sink is
log-only, nothing anchors, and the Hedera SDK (an `optionalDependency`, loaded lazily
only on the anchoring path) is never imported, so the passthrough runs unchanged. See
`.env.example` for the full var set.

There is no authenticated principal on this passthrough. When a call carries a
conventional owner/account arg that looks like a CAIP-10 id, that value is surfaced as a
best-effort, UNVERIFIED `subject` and the event is scoped `tenant`; it is a self-asserted
claim, never proof of identity, and gates nothing.

## Run

Build first, then start a transport.

```sh
npm install
npm run build

# stdio transport (for example a desktop MCP client config)
npm run start:stdio

# HTTP transport (for a hosted deploy; PORT defaults to 8080)
npm run start:http
```

The published binary defaults to the stdio transport:

```sh
npx h-series-mcp --transport stdio
```

Transport can also be selected with the `MCP_TRANSPORT` environment variable
(`stdio` or `http`).

### Startup schema-discipline check

On start the server fetches each backend's live config/manifest and checks
that the reported schema version is known and that each tool's path is still
advertised. Set `MCP_SKIP_VALIDATE=1` to skip it (useful when networking is
flaky in development); set `MCP_FAIL_ON_DRIFT=1` to exit non-zero on drift.

## Development

```sh
npm run typecheck   # tsc --noEmit
npm test            # compile, then run the node:test unit tests
npm run dev         # tsc --watch
```

Logging is structured JSON to stderr only, so the stdio JSON-RPC channel on
stdout stays clean. `LOG_LEVEL` (debug/info/warn/error) sets the threshold.

## License

MIT
