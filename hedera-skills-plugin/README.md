# H-Series skills (for AI coding agents)

Agent Skills for building on the H-Series, the Hedera product family for the agentic
economy under XR Utilities. Teaches a coding agent two things:

- **h-index-registry**: discover agentic services (MCP servers, x402-paid APIs, agent
  tools) on H-Index, and register your own so agents can find it. H-Index is a
  capability registry anchored on Hedera Consensus Service (HCS), with a safety scan,
  liveness probe, and trust tiers over every listing.
- **h-seal-receipts**: make a service produce verifiable, two-party proof-of-execution
  receipts via H-Seal with zero code (a signing sidecar in front of the service), then
  advertise it as a discovery signal in H-Index.

Both are read-first and non-custodial: discovery is free and unauthenticated, writes are
authorized by a TIP-712/EIP-712 signature the caller controls, and the sidecar never
holds a submit key for anyone but the provider it runs for.

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

- H-Index registry: `https://h-index.xr-utilities.ai` (read `GET /config` for the full
  contract: registry topic id, price, payment rails, TIP-712 domain/types)
- H-Series MCP server: `https://mcp.xr-utilities.ai` (hosted, exposes `h_index_search`,
  `h_index_register`, and the rest as MCP tools)
- H-Seal receipts: `https://h-seal.xr-utilities.ai`

## License

Apache-2.0.
