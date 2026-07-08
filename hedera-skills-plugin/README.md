# H-Series skills (for AI coding agents)

Agent Skills for building on the H-Series, a family of Hedera services for the agentic
economy under XR Utilities. The whole suite is exposed as live tools by one hosted MCP
server, so these skills are the knowledge layer: the suite map, and the client-side flows
(signing, x402 payment, zero-code receipt anchoring) that are not tool calls.

## Skills

One hub plus a focused skill per service. The hub connects the MCP server (the tool layer)
and routes to the right product skill; each product skill is the knowledge layer (when to
use it and its client-side flow), not a restatement of the tool catalog.

- **h-series-suite**: the entry point. Connect the hosted MCP server at
  `https://mcp.xr-utilities.ai/mcp` for the whole suite (44 tools across 8 products), plus the
  map of when to reach for which product and the two cross-cutting client-side flows (TIP-712
  signing for writes, x402 stablecoin payment for paid tools).
- **h-index-registry**: discover and register agentic services on H-Index (register signing + x402).
- **h-seal-receipts**: zero-code two-party proof-of-execution receipts via the H-Seal sidecar.
- **h-grant-authorization**: give an agent a scoped, owner-signed capability (H-Grant).
- **h-relay-transport**: agent mailbox, liveness heartbeat, and verifiable context proxy (H-Relay).
- **h-gate-egress**: inspect and gate an agent's outbound data, allow/redact/block (H-Gate).
- **h-cert-standing**: check a principal's behavior standing before trusting it (H-Cert).
- **h-pact-rings**: owner-signed, on-chain membership rings (H-Pact).
- **h-scope-posture**: score a wallet's behavioral risk before transacting (H-Scope).
- **h-agent-runtime**: give an agent a capped, non-custodial spending identity (H-Agent).

Everything is read-first and non-custodial: reads/discovery are free and unauthenticated,
writes are authorized by a signature the caller controls, and the sidecar only holds the
provider key it runs for.

## Install

Claude Code:

```
/plugin marketplace add XR-Utilities/h-series-skills
/plugin install h-series
```

Or via the skills CLI:

```
npx skills@latest add XR-Utilities/h-series-skills
```

## Live services

- H-Series MCP server (the whole suite): `https://mcp.xr-utilities.ai/mcp`
- H-Index registry: `https://h-index.xr-utilities.ai` (read `GET /config` for the contract)
- H-Seal receipts: `https://h-seal.xr-utilities.ai`
- H-Grant, H-Gate, H-Cert, H-Scope at `https://h-<name>.xr-utilities.ai`; H-Relay at
  `https://h-relay-production.up.railway.app`; H-Agent at `https://h-agent.xr-utilities.ai`

## License

Apache-2.0.
