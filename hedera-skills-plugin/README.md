# H-Series skills (for AI coding agents)

Agent Skills for building on the H-Series, a family of Hedera services for the agentic
economy under XR Utilities. The whole suite is exposed as live tools by one hosted MCP
server, so these skills are the knowledge layer: the suite map, and the client-side flows
(signing, x402 payment, zero-code receipt anchoring) that are not tool calls.

## Skills

- **h-series-suite**: the entry point. Connect the hosted MCP server at
  `https://mcp.xr-utilities.ai/mcp` to get the whole suite (44 tools across 8 products),
  plus the map of when to reach for which product (H-Index, H-Seal, H-Grant, H-Relay,
  H-Gate, H-Cert, H-Pact, H-Scope, and H-Agent) and the two cross-cutting client-side flows
  (TIP-712 signing for writes, x402 stablecoin payment for paid tools).
- **h-index-registry**: the deep-dive on discovering and registering agentic services on
  H-Index, including the register signing (TIP-712/EIP-712) and x402 payment contract.
- **h-seal-receipts**: the deep-dive on producing verifiable, two-party proof-of-execution
  receipts via H-Seal with zero code (a signing sidecar in proxy mode).

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
