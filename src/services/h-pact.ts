import type { ServiceDef } from "../types.js";

/**
 * H-Pact: signed, on-chain membership rings. The MCP server exposes the public
 * surface: the free config, the free public ring read, the paid ring creation,
 * and the owner-signed governance writes (admit, evict, policy update, renew).
 *
 * Deliberately NOT exposed:
 *  - the membership check (GET /rings/{ringId}/check) and the member roster
 *    (GET /rings/{ringId}/members). Both are authenticated over the ed25519
 *    sister-key S2S channel (a privacy oracle, not a public read), and the MCP
 *    passthrough holds no sister key. Consumers that hold a registered sister key
 *    call them directly; through MCP an agent sees only the public ring metadata.
 *
 * Every write is owner-signed (TIP-712/EIP-712/Ed25519) with the signature in the
 * body. Ring creation additionally settles a $10 x402 micropayment; admit, evict,
 * policy update, and renew are free.
 */
export const hPact: ServiceDef = {
  id: "h-pact",
  label: "H-Pact",
  baseUrl: "https://h-pact.xr-utilities.ai",
  manifestUrl: "https://h-pact.xr-utilities.ai/config",
  knownSchemaVersions: ["1"],
  tools: [
    {
      name: "h_pact_config",
      description:
        "Free. Get H-Pact configuration: the ring HCS topic id, the ring-create price, the " +
        "governance modes, the member roles and standing vocabulary, the event kinds, the signing " +
        "contract, and the accepted payment rails (with treasury payTo).",
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
      name: "h_pact_get_ring",
      description:
        "Free. Get a ring's public metadata by id: owner, governance mode, policy version, member " +
        "count, and timestamps. Returns no member identities (membership is stored on chain as " +
        "salted commitments; the authenticated roster and membership check are not exposed here).",
      inputSchema: {
        type: "object",
        properties: {
          ringId: { type: "string", description: "The ring id, e.g. '0.0.10587224/2'." },
        },
        required: ["ringId"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/rings/{ringId}",
      authMode: "free",
    },
    {
      name: "h_pact_create_ring",
      description:
        "Paid ($10 USD). Create a new membership ring under owner-signed rules. Requires a " +
        "TIP-712/EIP-712/Ed25519 owner signature over the canonical create body, plus an x402 " +
        "payment. Admit, evict, policy update, and renew are free afterward. Pass governanceMode " +
        "(only 'single-owner' is active in v1), optional policy, ownerAccountId, ringTopicId, " +
        "issuedAt, signature, and payment_signature.",
      inputSchema: {
        type: "object",
        properties: {
          governanceMode: {
            type: "string",
            enum: ["single-owner", "federated", "consensus"],
            description: "Governance model. Only 'single-owner' is active in v1.",
          },
          policy: { type: "string", description: "Optional ring policy document as a JSON string (max 32KB)." },
          ownerAccountId: { type: "string", description: "CAIP-10 identity of the creating owner (signer)." },
          ringTopicId: { type: "string", description: "The ring HCS topic id (from h_pact_config), e.g. '0.0.10587224'." },
          issuedAt: { type: "number", description: "Signature timestamp, unix seconds." },
          signature: { type: "string", description: "Owner signature over the canonical create body." },
          payment_signature: { type: "string", description: "x402 payment header (base64)." },
        },
        required: ["governanceMode", "ownerAccountId", "ringTopicId", "issuedAt", "signature"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/rings",
      authMode: "inline_x402",
      bodyFromArgs: true,
      stripArgs: ["payment_signature"],
      priceUsd: 10,
    },
    {
      name: "h_pact_admit",
      description:
        "Free. Admit a member to a ring you own. Owner-signed; the member identity is recorded on " +
        "chain as a salted commitment. Pass ringId, memberIdentity, optional salt/role/expiresAt, " +
        "ownerAccountId, ringTopicId, issuedAt, signature.",
      inputSchema: {
        type: "object",
        properties: {
          ringId: { type: "string", description: "The ring id to admit into (must match the signed body)." },
          memberIdentity: { type: "string", description: "CAIP-10 identity of the member to admit." },
          salt: { type: "string", description: "Optional 16-64 byte hex salt; generated server-side when omitted." },
          role: {
            type: "string",
            enum: ["owner", "admin", "member", "observer"],
            description: "Member role. Default 'member'.",
          },
          expiresAt: { type: "number", description: "Optional membership expiry, unix seconds." },
          ownerAccountId: { type: "string", description: "CAIP-10 identity of the ring owner (signer)." },
          ringTopicId: { type: "string", description: "The ring HCS topic id." },
          issuedAt: { type: "number", description: "Signature timestamp, unix seconds." },
          signature: { type: "string", description: "Owner signature over the canonical admit body." },
        },
        required: ["ringId", "memberIdentity", "ownerAccountId", "ringTopicId", "issuedAt", "signature"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/rings/{ringId}/admit",
      authMode: "free",
      bodyFromArgs: true,
      keepPathParamsInBody: true,
    },
    {
      name: "h_pact_evict",
      description:
        "Free. Evict a member from a ring you own. Owner-signed; recorded on chain. Pass ringId, " +
        "memberIdentity, optional evidenceRef, ownerAccountId, ringTopicId, issuedAt, signature.",
      inputSchema: {
        type: "object",
        properties: {
          ringId: { type: "string", description: "The ring id to evict from (must match the signed body)." },
          memberIdentity: { type: "string", description: "CAIP-10 identity of the member to evict." },
          evidenceRef: { type: "string", description: "Optional reference to eviction evidence (max 2000 chars)." },
          ownerAccountId: { type: "string", description: "CAIP-10 identity of the ring owner (signer)." },
          ringTopicId: { type: "string", description: "The ring HCS topic id." },
          issuedAt: { type: "number", description: "Signature timestamp, unix seconds." },
          signature: { type: "string", description: "Owner signature over the canonical evict body." },
        },
        required: ["ringId", "memberIdentity", "ownerAccountId", "ringTopicId", "issuedAt", "signature"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/rings/{ringId}/evict",
      authMode: "free",
      bodyFromArgs: true,
      keepPathParamsInBody: true,
    },
    {
      name: "h_pact_update_policy",
      description:
        "Free. Update a ring's policy document. Owner-signed; recorded on chain and bumps the " +
        "policy version. Pass ringId, policy (JSON string), ownerAccountId, ringTopicId, issuedAt, " +
        "signature.",
      inputSchema: {
        type: "object",
        properties: {
          ringId: { type: "string", description: "The ring id to update (must match the signed body)." },
          policy: { type: "string", description: "The new ring policy document as a JSON string (max 32KB)." },
          ownerAccountId: { type: "string", description: "CAIP-10 identity of the ring owner (signer)." },
          ringTopicId: { type: "string", description: "The ring HCS topic id." },
          issuedAt: { type: "number", description: "Signature timestamp, unix seconds." },
          signature: { type: "string", description: "Owner signature over the canonical policy body." },
        },
        required: ["ringId", "policy", "ownerAccountId", "ringTopicId", "issuedAt", "signature"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/rings/{ringId}/policy",
      authMode: "free",
      bodyFromArgs: true,
      keepPathParamsInBody: true,
    },
    {
      name: "h_pact_renew",
      description:
        "Free. Renew a member's membership to a new expiry. Owner-signed; recorded on chain. Pass " +
        "ringId, memberIdentity, newExpiresAt (unix seconds), ownerAccountId, ringTopicId, issuedAt, " +
        "signature.",
      inputSchema: {
        type: "object",
        properties: {
          ringId: { type: "string", description: "The ring id (must match the signed body)." },
          memberIdentity: { type: "string", description: "CAIP-10 identity of the member to renew." },
          newExpiresAt: { type: "number", description: "The new membership expiry, unix seconds." },
          ownerAccountId: { type: "string", description: "CAIP-10 identity of the ring owner (signer)." },
          ringTopicId: { type: "string", description: "The ring HCS topic id." },
          issuedAt: { type: "number", description: "Signature timestamp, unix seconds." },
          signature: { type: "string", description: "Owner signature over the canonical renew body." },
        },
        required: ["ringId", "memberIdentity", "newExpiresAt", "ownerAccountId", "ringTopicId", "issuedAt", "signature"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/rings/{ringId}/renew",
      authMode: "free",
      bodyFromArgs: true,
      keepPathParamsInBody: true,
    },
  ],
};
