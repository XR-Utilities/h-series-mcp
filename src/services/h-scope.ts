import type { ServiceDef } from "../types.js";

/**
 * H-Scope: universal multi-chain wallet behavior scanner. The MCP server exposes
 * the public agent surface: the free self-describing config and the paid scan.
 *
 * The showroom's free scan path (a sister-key S2S exemption) is deliberately not
 * exposed here: agents pay the $0.10 scan fee via x402 like any other paid tool,
 * and the MCP passthrough holds no sister key. A scan is a read of a third-party
 * address, so the paid path is not payer-bound (the backend still re-verifies the
 * settlement on chain and replay-guards it).
 */
export const hScope: ServiceDef = {
  id: "h-scope",
  label: "H-Scope",
  baseUrl: "https://h-scope.xr-utilities.ai",
  manifestUrl: "https://h-scope.xr-utilities.ai/config",
  knownSchemaVersions: ["0.0.4"],
  tools: [
    {
      name: "h_scope_config",
      description:
        "Free. Get H-Scope configuration: the per-scan price, the supported chains, the scan " +
        "modes (pre_auth, standing, full), and the signal catalog (every behavioral signal " +
        "H-Scope can emit, with its category and supported chains).",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/config",
      authMode: "free",
    },
    {
      name: "h_scope_scan",
      description:
        "Paid ($0.10 USD). Scan an on-chain wallet for behavioral signals and an entity-posture " +
        "read, computed live from public chain data. Returns deterministic signals plus, in the " +
        "fuller modes, an activity/posture summary and AI-written reasoning. This is a read of a " +
        "third-party address (not payer-bound). Pass subject (the address or CAIP-10 to scan), an " +
        "optional mode, and an x402 payment_signature.",
      inputSchema: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "The wallet to scan: a chain address or CAIP-10 account id.",
          },
          mode: {
            type: "string",
            enum: ["pre_auth", "standing", "full"],
            description: "Scan depth. Default 'full'.",
          },
          payment_signature: { type: "string", description: "x402 payment header (base64)." },
        },
        required: ["subject"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/scan",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
      priceUsd: 0.1,
    },
  ],
};
