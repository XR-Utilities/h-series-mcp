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
    {
      name: "h_relay_publish_heartbeat",
      description:
        "Free. Publish your own liveness to the Broadcast feed. Requires a TIP-712 heartbeat " +
        "authorization signed by the publisher over its identity. Rate-limited per publisher. " +
        "Use h_relay_heartbeat to read the feed.",
      inputSchema: {
        type: "object",
        properties: {
          identity: {
            type: "string",
            description: "Publisher identity (CAIP-10). Must match the authorization signer.",
          },
          authorization: {
            type: "object",
            description: "TIP-712 heartbeat authorization signed by the publisher.",
            properties: {
              scheme: { type: "string" },
              signature: { type: "string" },
              issuedAt: { type: "number" },
            },
            required: ["scheme", "signature", "issuedAt"],
          },
        },
        required: ["identity", "authorization"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/heartbeat",
      authMode: "free",
      bodyFromArgs: true,
    },
    {
      name: "h_relay_relay",
      description:
        "Paid ($0.05 USD). Context proxy / verifiable agent egress: fetch context from a " +
        "registry-known source (an H-Index listing id; arbitrary URLs are refused). H-Relay " +
        "fetches it under SSRF-safe controls, optionally scans the inbound content for " +
        "prompt-injection and redacts outbound secrets/PII per policy, returns the content, and " +
        "anchors a tamper-evident provenance record (request hash + response hash) to a public " +
        "ledger. Requires a TIP-712 relay authorization signed by the caller and x402 payment. " +
        "Returns the content, content type, the request/response hashes, applied sanitization, " +
        "and a relay record id (poll h_relay_get_relay for the on-chain anchor ref).",
      inputSchema: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "Caller identity (CAIP-10). Must match the authorization signer.",
          },
          target: {
            type: "string",
            description: "An H-Index listing id (topicId/seq) to fetch from; resolves to its registered endpoint.",
          },
          authorization: {
            type: "object",
            description: "TIP-712 relay authorization signed by the caller over { from, target }.",
            properties: {
              scheme: { type: "string", description: "Signing scheme, e.g. tip712 or ed25519." },
              signature: { type: "string", description: "Signature over the relay action." },
              issuedAt: { type: "number", description: "Unix seconds the signature was issued." },
            },
            required: ["scheme", "signature", "issuedAt"],
          },
          policy: {
            type: "object",
            description: "Optional sanitization toggles, both default off.",
            properties: {
              scanInbound: {
                type: "boolean",
                description: "Scan the fetched content for prompt-injection and flag findings.",
              },
              redactOutbound: {
                type: "boolean",
                description: "Redact secrets/PII from the returned content.",
              },
            },
            additionalProperties: false,
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header (base64-encoded envelope).",
          },
        },
        required: ["from", "target", "authorization"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/relay",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
      priceUsd: 0.05,
    },
    {
      name: "h_relay_get_relay",
      description:
        "Free. Get a public relay provenance record by id: the request/response hashes, the " +
        "target listing id, applied sanitization, and the on-chain anchor reference. Never the " +
        "fetched content or the caller identity.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Relay record id." } },
        required: ["id"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/relay/{id}",
      authMode: "free",
    },
    {
      name: "h_relay_list_deliveries",
      description:
        "Free. List recent deliveries already anchored on the public HCS topic, newest first. " +
        "Public projection only (id, status, anchor refs); never bodies, identities, or routing.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max records to return (1-100, default 25)." },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/deliveries",
      authMode: "free",
    },
    {
      name: "h_relay_config",
      description:
        "Free. Public service manifest: endpoints, prices, payment rails, and the TIP-712 signing " +
        "contract for authorizing H-Relay requests.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      method: "GET",
      path: "/config",
      authMode: "free",
    },
  ],
};
