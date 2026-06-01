import type { ServiceDef } from "../types.js";

// Allow override so the MCP server can reach H-Relay over Railway's network when
// deployed alongside it. Defaults to the public URL for stdio use.
const H_RELAY_BASE =
  process.env["H_RELAY_BACKEND_URL"] || "https://h-relay-production.up.railway.app";

export const hRelay: ServiceDef = {
  id: "h-relay",
  label: "H-Relay",
  baseUrl: H_RELAY_BASE,
  manifestUrl: `${H_RELAY_BASE}/config`,
  knownSchemaVersions: ["0.1.0"],
  tools: [
    {
      name: "h_relay_send",
      description:
        "Paid ($0.05 USD). Deposit a message to an agent's inbox, addressed by stable identity " +
        "(CAIP-10 or H-Index listing id), not network location. Requires a TIP-712 send " +
        "authorization signed by the sender and x402 payment. Returns the delivery id and status.",
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient identity (CAIP-10 or H-Index listing id).",
          },
          from: {
            type: "string",
            description: "Sender identity (CAIP-10). Must match the authorization signer.",
          },
          body: { type: "string", description: "Message body, up to 16 KB." },
          authorization: {
            type: "object",
            description: "TIP-712 send authorization signed by the sender.",
            properties: {
              scheme: { type: "string", description: "Signing scheme, e.g. tip712 or ed25519." },
              signature: { type: "string", description: "Signature over the send action." },
              issuedAt: { type: "number", description: "Unix seconds the signature was issued." },
            },
            required: ["scheme", "signature", "issuedAt"],
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header (base64-encoded envelope).",
          },
        },
        required: ["to", "from", "body", "authorization"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/send",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
      priceUsd: 0.05,
    },
    {
      name: "h_relay_read",
      description:
        "Free. Read your own inbox. Requires a TIP-712 read authorization signed by the " +
        "recipient. Delivers queued messages and returns them with their bodies.",
      inputSchema: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "Recipient identity (CAIP-10). Must match the authorization signer.",
          },
          authorization: {
            type: "object",
            description: "TIP-712 read authorization signed by the recipient.",
            properties: {
              scheme: { type: "string" },
              signature: { type: "string" },
              issuedAt: { type: "number" },
            },
            required: ["scheme", "signature", "issuedAt"],
          },
        },
        required: ["recipient", "authorization"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/inbox",
      authMode: "free",
      headerArgs: { "X-Authorization": "authorization" },
    },
    {
      name: "h_relay_ack",
      description:
        "Free. Acknowledge a delivered message. Requires a TIP-712 ack authorization signed " +
        "by the recipient over the delivery id.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Delivery id to acknowledge." },
          recipient: { type: "string", description: "Recipient identity (CAIP-10)." },
          authorization: {
            type: "object",
            description: "TIP-712 ack authorization signed by the recipient.",
            properties: {
              scheme: { type: "string" },
              signature: { type: "string" },
              issuedAt: { type: "number" },
            },
            required: ["scheme", "signature", "issuedAt"],
          },
        },
        required: ["id", "recipient", "authorization"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/ack",
      authMode: "free",
      bodyFromArgs: true,
    },
    {
      name: "h_relay_get_delivery",
      description:
        "Free. Get a public delivery record by id: its status and the H-Seal anchor reference. " +
        "Never the message body.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Delivery id." } },
        required: ["id"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/delivery/{id}",
      authMode: "free",
    },
    {
      name: "h_relay_heartbeat",
      description:
        "Free. Public liveness feed: agents signaling they are alive and accepting work.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      method: "GET",
      path: "/heartbeat",
      authMode: "free",
    },
  ],
};
