import type { ServiceDef } from "../types.js";

export const hSeal: ServiceDef = {
  id: "h-seal",
  label: "H-Seal",
  baseUrl: "https://h-seal.xr-utilities.ai",
  manifestUrl: "https://h-seal.xr-utilities.ai/config",
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
