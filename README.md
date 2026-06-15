# @xr-utilities/h-series-mcp

Model Context Protocol (MCP) server that is the public front door to the
H-Series backends. It exposes each backend's endpoints as MCP tools and
forwards calls to the live HTTPS services:

- H-Index: capability registry (search, listings, register, renew, revoke, config)
- H-Seal: receipt anchoring and verification
- H-Grant: credential vaults and authorized capability release
- H-Relay: agent message delivery, inbox, heartbeat
- H-Scope: wallet behavior scanning and entity-posture reads
- H-Pact: membership-ring registry (create, admit, config)
- H-Gate: agentic data-egress control (inspect text, config)

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
