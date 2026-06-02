import type { ServiceDef } from "../types.js";

// Allow override so the MCP server can reach H-Seal over Railway's private
// network when deployed alongside it. Avoids Cloudflare bot challenges on
// the public hostname. Defaults to the public URL for stdio use.
const H_SEAL_BASE = process.env["H_SEAL_BACKEND_URL"] || "https://h-seal.xr-utilities.ai";

export const hSeal: ServiceDef = {
  id: "h-seal",
  label: "H-Seal",
  baseUrl: H_SEAL_BASE,
  manifestUrl: `${H_SEAL_BASE}/config`,
  knownSchemaVersions: ["0.1.0"],
  tools: [
    {
      name: "h_seal_anchor",
      description:
        "Paid ($0.05 USD). Anchor a cryptographic receipt on Hedera Consensus Service. " +
        "Requires a TIP-712/EIP-712 signed receipt payload and x402 payment. " +
        "Returns the receipt ID, consensus timestamp, and payment transaction ID.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Unique identifier for the interaction being receipted.",
          },
          serviceEndpoint: {
            type: "string",
            description: "URL of the service that was called.",
          },
          requestHash: {
            type: "string",
            description: "SHA-256 hex hash of the request payload.",
          },
          responseHash: {
            type: "string",
            description: "SHA-256 hex hash of the response payload.",
          },
          resultStatus: {
            type: "string",
            description: "Outcome of the interaction.",
            enum: ["success", "error", "timeout", "partial"],
          },
          startedAt: {
            type: "number",
            description: "Unix timestamp when the request was sent.",
          },
          completedAt: {
            type: "number",
            description: "Unix timestamp when the response was received.",
          },
          latencyMs: {
            type: "number",
            description: "Measured round-trip time in milliseconds.",
          },
          callerIdentity: {
            type: "string",
            description: "CAIP-10 identity of the caller.",
          },
          providerIdentity: {
            type: "string",
            description: "CAIP-10 identity of the service provider (optional).",
          },
          receiptTopicId: {
            type: "string",
            description: "HCS receipt topic ID.",
          },
          issuedAt: {
            type: "number",
            description: "Unix timestamp of the signature.",
          },
          signature: {
            type: "string",
            description: "TIP-712/EIP-712 hex signature over the receipt payload.",
          },
          payment_signature: {
            type: "string",
            description: "x402 payment header (base64-encoded envelope).",
          },
          schemaVersion: {
            type: "number",
            description: "Receipt schema version. Omit or 1 for v0.1. Set to 2 to include the v0.2 fields below in the signed payload.",
          },
          method: {
            type: "string",
            description: "(v0.2) Operation name, e.g. \"tools/call:xrpl_send_payment\" or \"POST /v1/translate\".",
          },
          httpStatus: {
            type: "number",
            description: "(v0.2) HTTP status code of the underlying call (REST integrations).",
          },
          correlationId: {
            type: "string",
            description: "(v0.2) Free-form ID linking related receipts across a multi-step workflow.",
          },
          amountPaid: {
            type: "string",
            description: "(v0.2) Amount paid to the provider for the underlying service, as a decimal string. Separate from the H-Seal anchoring fee.",
          },
          amountCurrency: {
            type: "string",
            description: "(v0.2) Currency for amountPaid, e.g. \"USD\", \"USDC\", \"HBAR\".",
          },
          providerSignature: {
            type: "string",
            description: "(v0.3) Provider's hex signature over {providerIdentity, requestHash, responseHash, providerIssuedAt}. Requires providerSignatureScheme and providerIssuedAt to also be set.",
          },
          providerSignatureScheme: {
            type: "string",
            description: "(v0.3) Signature scheme used by the provider. v0.3 supports \"ed25519\" only.",
            enum: ["ed25519"],
          },
          providerIssuedAt: {
            type: "number",
            description: "(v0.3) Unix timestamp when the provider signed the attestation.",
          },
        },
        required: [
          "taskId", "serviceEndpoint", "requestHash", "responseHash",
          "resultStatus", "startedAt", "completedAt", "latencyMs",
          "callerIdentity", "receiptTopicId", "issuedAt", "signature",
        ],
        additionalProperties: false,
      },
      method: "POST",
      path: "/anchor",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
      priceUsd: 0.05,
    },
    {
      name: "h_seal_anchor_request",
      description:
        "Free. Anchor a request envelope (the notary: the inbound counterpart to a receipt, " +
        "proving what an agent was asked to do). Requires a TIP-712/EIP-712 signed envelope. " +
        "An optional recipient acknowledgement may be included. Returns the request ID and " +
        "consensus timestamp. Fails with 503 if the server has no request topic configured.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            description: "Unique identifier for the inbound request.",
          },
          targetEndpoint: {
            type: "string",
            description: "The service being called, ideally an H-Index listing id (topic/sequence) rather than a raw URL.",
          },
          requestHash: {
            type: "string",
            description: "SHA-256 hex hash of the request payload.",
          },
          callerIdentity: {
            type: "string",
            description: "CAIP-10 identity of the calling agent (or Hedera account id).",
          },
          recipientIdentity: {
            type: "string",
            description: "CAIP-10 identity of the recipient the request is addressed to.",
          },
          sentAt: {
            type: "number",
            description: "Unix timestamp when the request was sent (also the signature freshness time).",
          },
          requestTopicId: {
            type: "string",
            description: "HCS request-envelope topic ID (must match the server's configured topic).",
          },
          signature: {
            type: "string",
            description: "Caller's signature over {kind:\"anchor_request\", payload} (EIP-712 RequestEnvelope for EVM; canonical-JSON ed25519 for Hedera/XRPL/Solana).",
          },
          recipientAck: {
            type: "string",
            description: "Optional. Recipient's hex signature over {kind:\"request_ack\", payload:{recipientIdentity, requestId, requestHash, ackIssuedAt}}. Hedera Ed25519 only. Requires recipientAckScheme and recipientAckIssuedAt.",
          },
          recipientAckScheme: {
            type: "string",
            description: "Optional. Signature scheme for recipientAck. v1 supports \"ed25519\" only.",
            enum: ["ed25519"],
          },
          recipientAckIssuedAt: {
            type: "number",
            description: "Optional. Unix timestamp when the recipient signed the acknowledgement.",
          },
        },
        required: [
          "requestId", "targetEndpoint", "requestHash", "callerIdentity",
          "recipientIdentity", "sentAt", "requestTopicId", "signature",
        ],
        additionalProperties: false,
      },
      method: "POST",
      path: "/anchor-request",
      authMode: "free",
      bodyFromArgs: true,
    },
    {
      name: "h_seal_get_request",
      description:
        "Free. Retrieve a single anchored request envelope by its ID (topic/sequence format). " +
        "Returns the envelope details including identities, hashes, timing, and any recipient acknowledgement.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Request envelope ID in topic/sequence format.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/requests/{id}",
      authMode: "free",
    },
    {
      name: "h_seal_list_requests",
      description:
        "Free. List anchored request envelopes. Filter by caller or recipient identity. " +
        "Returns paginated results with a cursor for subsequent pages.",
      inputSchema: {
        type: "object",
        properties: {
          caller: {
            type: "string",
            description: "Filter by caller identity (CAIP-10 format).",
          },
          recipient: {
            type: "string",
            description: "Filter by recipient identity (CAIP-10 format).",
          },
          limit: {
            type: "number",
            description: "Max results per page (default 50, max 100).",
          },
          cursor: {
            type: "string",
            description: "Pagination cursor from a previous response.",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/requests",
      authMode: "free",
    },
    {
      name: "h_seal_get_receipt",
      description:
        "Free. Retrieve a single anchored receipt by its ID (topic/sequence format, e.g. 0.0.12345/42). " +
        "Returns full receipt details including task ID, hashes, timing, identities, and consensus timestamp.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Receipt ID in topic/sequence format.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/receipts/{id}",
      authMode: "free",
    },
    {
      name: "h_seal_list_receipts",
      description:
        "Free. List anchored receipts. Filter by caller identity, provider identity, or task ID. " +
        "Returns paginated results with a cursor for subsequent pages.",
      inputSchema: {
        type: "object",
        properties: {
          caller: {
            type: "string",
            description: "Filter by caller identity (CAIP-10 format).",
          },
          provider: {
            type: "string",
            description: "Filter by provider identity (CAIP-10 format).",
          },
          taskId: {
            type: "string",
            description: "Filter by task ID.",
          },
          limit: {
            type: "number",
            description: "Max results per page (default 50, max 100).",
          },
          cursor: {
            type: "string",
            description: "Pagination cursor from a previous response.",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/receipts",
      authMode: "free",
    },
    {
      name: "h_seal_verify",
      description:
        "Free. Verify a receipt exists on-chain by fetching it from the H-Seal API. " +
        "Equivalent to h_seal_get_receipt but named for discoverability when an agent " +
        "wants to confirm a receipt is genuine.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Receipt ID to verify (topic/sequence format).",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/receipts/{id}",
      authMode: "free",
    },
    {
      name: "h_seal_config",
      description:
        "Free. Get H-Seal configuration: receipt topic ID, anchoring fee, accepted payment methods.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      method: "GET",
      path: "/config",
      authMode: "free",
    },
  ],
};
