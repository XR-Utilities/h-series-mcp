import type { ServiceDef } from "../types.js";
import { priceUsd } from "../prices.js";

/**
 * H-Gate: agentic data-egress control (DLP). The MCP server exposes the public
 * agent surface: the free self-describing config and the paid inspect.
 *
 * The showroom's free inspect path (a sister-key S2S exemption) is deliberately
 * not exposed here: agents pay the $0.10 inspect fee via x402 like any other
 * paid tool, and the MCP passthrough holds no sister key. Inspect operates on
 * caller-supplied text, so the paid path is not payer-bound (the backend still
 * re-verifies the settlement on chain and replay-guards it).
 */
export const hGate: ServiceDef = {
  id: "h-gate",
  label: "H-Gate",
  baseUrl: "https://h-gate.xr-utilities.ai",
  manifestUrl: "https://h-gate.xr-utilities.ai/config",
  knownSchemaVersions: [],
  tools: [
    {
      name: "h_gate_config",
      description:
        "Free. Get H-Gate configuration: the per-inspect price and the accepted x402 payment " +
        "rails (chain, asset, amount, and treasury) across every supported chain.",
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
      name: "h_gate_inspect",
      get description() {
        return (
        `Paid ($${priceUsd("h_gate_inspect")} USD). Inspect text an agent is about to send across a boundary and apply a ` +
        "data-egress policy. Returns a decision (allow, redact, or block), the redacted text, the " +
        "detections (entity type, sensitivity, detector, span), and per-type counts. A redact or " +
        "block emits an H-Seal receipt so the action is provable. Pass text (the content to " +
        "inspect), an optional policy (a named policy: redact-all, block-secrets-redact-pii, or " +
        "block-critical; default block-secrets-redact-pii), and an x402 payment_signature."
        );
      },
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The content to inspect before it crosses the boundary.",
          },
          policy: {
            type: "string",
            enum: ["redact-all", "block-secrets-redact-pii", "block-critical"],
            description: "Named egress policy. Default 'block-secrets-redact-pii'.",
          },
          payment_signature: { type: "string", description: "x402 payment header (base64)." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/inspect",
      authMode: "inline_x402",
      bodyFromArgs: true,
      priceUsd: 0.1,
    },
  ],
};
