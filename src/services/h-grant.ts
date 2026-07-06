import type { ServiceDef } from "../types.js";
import { priceUsd } from "../prices.js";

/**
 * H-Grant: capability-bound credential release. The MCP server exposes only the
 * public surface of the H-Grant REST API and forwards to the backend, which
 * remains the validator.
 *
 * Deliberately NOT exposed:
 *  - vault/deposit: depositing involves a raw credential, which must never
 *    transit this public passthrough. Deposit is done directly against the
 *    backend, not as an agent tool.
 *  - audit read: it is owner-signed via x-owner-* request headers, which the
 *    dispatcher does not map from tool args; the public showroom explorer covers
 *    audit reads instead.
 *
 * No secret transits any tool here: a release returns only the upstream result,
 * never the credential; grants are owner-signed policy, not secrets, with the
 * signature carried in the body.
 */
export const hGrant: ServiceDef = {
  id: "h-grant",
  label: "H-Grant",
  baseUrl: "https://h-grant.xr-utilities.ai",
  manifestUrl: "https://h-grant.xr-utilities.ai/config",
  knownSchemaVersions: ["0.1.0"],
  tools: [
    {
      name: "h_grant_config",
      description:
        "Free. Get H-Grant configuration: HCS audit/grant topic IDs, the per-release price, " +
        "accepted payment chains, and available adapters.",
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
      name: "h_grant_call",
      get description() {
        return (
        `Paid ($${priceUsd("h_grant_call")} USD). Release a credential's capability: H-Grant uses the owner's stored ` +
        "credential to perform the authorized action against the upstream service and returns only " +
        "the upstream result, never the credential itself. Requires an active owner-signed grant " +
        "covering the grantee and action, plus an x402 payment. Pass vaultId, granteeIdentity, " +
        "action, optional targetId, payload, and payment_signature."
        );
      },
      inputSchema: {
        type: "object",
        properties: {
          vaultId: { type: "string", description: "ID of the vault holding the credential." },
          granteeIdentity: { type: "string", description: "CAIP-10 identity of the calling agent (the grantee)." },
          action: { type: "string", description: "The action to perform, e.g. 'stripe:POST /v1/charges'." },
          targetId: { type: "string", description: "Optional target identifier the action operates on." },
          payload: { type: "object", description: "Adapter-specific request payload, forwarded upstream.", additionalProperties: true },
          payment_signature: { type: "string", description: "x402 payment header (base64)." },
        },
        required: ["vaultId", "granteeIdentity", "action"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/call/{vaultId}",
      authMode: "inline_x402",
      bodyFromArgs: true,
      priceUsd: 0.05,
    },
    {
      name: "h_grant_publish",
      description:
        "Free. Publish an owner-signed grant authorizing a grantee to take specific actions within " +
        "caps until an expiry. Requires a TIP-712/EIP-712/Ed25519 owner signature; verified, then " +
        "anchored on Hedera. Pass the signed grant body fields.",
      inputSchema: {
        type: "object",
        properties: {
          grantId: { type: "string", description: "Unique grant ID." },
          vaultId: { type: "string", description: "Vault this grant authorizes against." },
          granteeIdentity: { type: "string", description: "CAIP-10 identity allowed to call." },
          ownerIdentity: { type: "string", description: "CAIP-10 identity of the vault owner (signer)." },
          allowedActions: { type: "array", items: { type: "string" }, description: "Actions the grantee may take." },
          targetAllowlist: { type: "array", items: { type: "string" }, description: "Optional allowed target identifiers." },
          caps: {
            type: "object",
            description: "Spend caps in US cents.",
            properties: {
              perCallUsdCents: { type: "number" },
              dailyUsdCents: { type: "number" },
              weeklyUsdCents: { type: "number" },
            },
            additionalProperties: false,
          },
          requiredAttestations: { type: "array", items: { type: "string" }, description: "Required attestations (default [])." },
          validUntil: { type: "number", description: "Expiry, unix seconds." },
          issuedAt: { type: "number", description: "Signature timestamp, unix seconds." },
          nonce: { type: "string", description: "Replay nonce." },
          signatureScheme: { type: "string", enum: ["tip712", "eip712", "ed25519"], description: "Signature scheme." },
          ownerSignature: { type: "string", description: "Owner signature over the canonical grant body." },
          ownerPublicKey: { type: "string", description: "Owner public key (required for ed25519)." },
        },
        required: [
          "grantId", "vaultId", "granteeIdentity", "ownerIdentity", "allowedActions",
          "validUntil", "issuedAt", "nonce", "signatureScheme", "ownerSignature",
        ],
        additionalProperties: false,
      },
      method: "POST",
      path: "/grant/publish",
      authMode: "free",
      bodyFromArgs: true,
    },
    {
      name: "h_grant_revoke",
      description:
        "Free. Revoke a grant you own. Requires an owner signature over the revocation body; " +
        "honored on every subsequent release check and anchored on Hedera.",
      inputSchema: {
        type: "object",
        properties: {
          grantId: { type: "string", description: "ID of the grant to revoke." },
          vaultId: { type: "string", description: "Vault the grant belongs to." },
          ownerIdentity: { type: "string", description: "CAIP-10 identity of the vault owner (signer)." },
          issuedAt: { type: "number", description: "Signature timestamp, unix seconds." },
          nonce: { type: "string", description: "Replay nonce." },
          reason: { type: "string", description: "Optional revocation reason." },
          signatureScheme: { type: "string", enum: ["tip712", "eip712", "ed25519"], description: "Signature scheme." },
          ownerSignature: { type: "string", description: "Owner signature over the canonical revocation body." },
          ownerPublicKey: { type: "string", description: "Owner public key (required for ed25519)." },
        },
        required: ["grantId", "vaultId", "ownerIdentity", "issuedAt", "nonce", "signatureScheme", "ownerSignature"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/grant/revoke",
      authMode: "free",
      bodyFromArgs: true,
    },
  ],
};
