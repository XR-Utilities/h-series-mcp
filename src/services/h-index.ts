import type { ServiceDef } from "../types.js";

export const hIndex: ServiceDef = {
  id: "h-index",
  label: "H-Index",
  baseUrl: "https://h-index.xr-utilities.ai",
  manifestUrl: "https://h-index.xr-utilities.ai/config",
  knownSchemaVersions: ["0.1.0"],
  tools: [
    {
      name: "h_index_search",
      description:
        "Free. Search the H-Index capability registry by keyword or semantic query. " +
        "Returns ranked listings of MCP servers, tool endpoints, and agent APIs with " +
        "endpoint URL, description, pricing, owner, MCP manifest snapshot, a trust label, " +
        "and a `provider` field (the registrable domain of the endpoint, e.g. " +
        "ottoai.services) that groups listings from the same company.",
      inputSchema: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Search query (keyword or natural language capability description).",
          },
          category: {
            type: "string",
            description: "Filter by category.",
            enum: ["developer-tools", "data", "ai-models", "infra", "productivity", "other"],
          },
          limit: {
            type: "number",
            description: "Max results (default 20, max 100).",
          },
          trust: {
            type: "string",
            description:
              "Trust-tier policy over results. attested_only: only owner-signed on-chain " +
              "registrations. observed_clean (default): attested plus clean third-party " +
              "observed listings. observed_any: everything, with flags inline.",
            enum: ["attested_only", "observed_clean", "observed_any"],
          },
          excludeFlags: {
            type: "string",
            description:
              "Comma-separated safety flags to exclude across all tiers, e.g. 'drift,vuln'. " +
              "Drops any listing carrying a named flag.",
          },
          paid: {
            type: "string",
            description:
              "Filter by paid status (comma-separated): paid, gated, open, unknown.",
          },
          tags: {
            type: "string",
            description: "Filter by derived domain tags (comma-separated, matches ANY).",
          },
        },
        additionalProperties: false,
      },
      method: "GET",
      path: "/endpoints",
      authMode: "free",
    },
    {
      name: "h_index_get_listing",
      description:
        "Free. Get a specific H-Index listing by its ID (topic/sequence format, e.g. 0.0.10601198/42). " +
        "Returns full detail including MCP manifest, pricing, owner, registration date, and expiry.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Listing ID in topic/sequence format.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      method: "GET",
      // The detail read is the two-segment route GET /endpoints/:topicId/:seq. The id
      // ("topicId/seq") carries the separator, so it maps via the raw {id*} placeholder
      // (slashes preserved) rather than ?id=, which the backend ignores (it would fall
      // back to the recent feed). See dispatch.ts path substitution.
      path: "/endpoints/{id*}",
      authMode: "free",
    },
    {
      name: "h_index_categories",
      description:
        "Free. List the registry categories (id + label) available for filtering discovery, " +
        "e.g. developer-tools, data, ai-models. Use a category id as the `category` filter on " +
        "h_index_search.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      method: "GET",
      path: "/categories",
      authMode: "free",
    },
    {
      name: "h_index_register",
      description:
        "Paid ($10.00 USD). Register a new service on H-Index. Requires a TIP-712/EIP-712 " +
        "signature and x402 payment. Pass the signed receipt body fields plus payment_signature.",
      inputSchema: {
        type: "object",
        properties: {
          apiName: { type: "string", description: "Service display name." },
          endpointUrl: { type: "string", description: "Service URL (https)." },
          description: { type: "string", description: "What the service does." },
          pricing: { type: "string", description: "Pricing info (JSON string)." },
          category: { type: "string", description: "Category." },
          mcpManifest: { type: "string", description: "MCP manifest JSON snapshot (optional)." },
          ownerAccountId: { type: "string", description: "CAIP-10 identity of the publisher." },
          registryTopicId: { type: "string", description: "HCS registry topic ID." },
          issuedAt: { type: "number", description: "Unix timestamp of signature." },
          signature: { type: "string", description: "TIP-712/EIP-712 hex signature." },
          payment_signature: { type: "string", description: "x402 payment header (base64)." },
        },
        required: ["apiName", "endpointUrl", "description", "pricing", "ownerAccountId", "registryTopicId", "issuedAt", "signature"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/register",
      authMode: "inline_x402",
      bodyFromArgs: true,
      priceUsd: 10.0,
    },
    {
      name: "h_index_renew",
      description:
        "Paid ($5.00 USD). Renew an existing H-Index listing before it expires, extending its term. " +
        "Requires a TIP-712/EIP-712 signature from the listing owner and x402 payment. Pass the " +
        "signed body fields plus payment_signature.",
      inputSchema: {
        type: "object",
        properties: {
          endpointId: { type: "string", description: "ID of the listing to renew." },
          ownerAccountId: { type: "string", description: "CAIP-10 identity of the listing owner." },
          registryTopicId: { type: "string", description: "HCS registry topic ID." },
          issuedAt: { type: "number", description: "Unix timestamp of signature." },
          signature: { type: "string", description: "TIP-712/EIP-712 hex signature over the renewal." },
          payment_signature: { type: "string", description: "x402 payment header (base64)." },
        },
        required: ["endpointId", "ownerAccountId", "registryTopicId", "issuedAt", "signature"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/renew",
      authMode: "inline_x402",
      bodyFromArgs: true,
      priceUsd: 5.0,
    },
    {
      name: "h_index_revoke",
      description:
        "Free. Revoke (remove) an H-Index listing you own. Requires a TIP-712/EIP-712 signature " +
        "from the listing owner; no payment. Pass the signed body fields.",
      inputSchema: {
        type: "object",
        properties: {
          endpointId: { type: "string", description: "ID of the listing to revoke." },
          ownerAccountId: { type: "string", description: "CAIP-10 identity of the listing owner." },
          registryTopicId: { type: "string", description: "HCS registry topic ID." },
          issuedAt: { type: "number", description: "Unix timestamp of signature." },
          signature: { type: "string", description: "TIP-712/EIP-712 hex signature over the revocation." },
        },
        required: ["endpointId", "ownerAccountId", "registryTopicId", "issuedAt", "signature"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/revoke",
      authMode: "free",
      bodyFromArgs: true,
    },
    {
      name: "h_index_config",
      description:
        "Free. Get H-Index registry configuration: topic ID, pricing, accepted payment methods.",
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
