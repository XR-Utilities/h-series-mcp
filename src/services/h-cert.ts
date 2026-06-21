import type { ServiceDef } from "../types.js";

/**
 * H-Cert: the standing + owner-delegation layer. An owner-signed "principal
 * directory" (named grantees/counterparties) plus a behavior-backed standing
 * verdict. It is the grant-builder's named-grantee directory.
 *
 * The MCP server exposes the read surface: resolve an owner->subject delegation
 * (with optional scope/standing requirements), read a subject's signed standing
 * verdict, read an owner's principal roster, and the free self-describing config.
 * All reads are free (H-Cert pricing is FREE). Standing is advisory, never
 * enforcing; a verdict is a point-in-time signal, not a guarantee.
 *
 * /standing/{subject} is the single-segment GET route: the subject is a CAIP-10
 * id (e.g. hedera:mainnet:0.0.x), read whole by the backend via c.req.param, so
 * it maps via the default {subject} placeholder (percent-encoded). This is the
 * inverse of H-Index's two-segment {id*} detail route.
 */
export const hCert: ServiceDef = {
  id: "h-cert",
  label: "H-Cert",
  baseUrl: "https://h-cert.xr-utilities.ai",
  manifestUrl: "https://h-cert.xr-utilities.ai/config",
  // H-Cert's /config does not report a schema_version yet, so leave this empty:
  // the validator then only warns (never errors) on an unrecognized live version.
  knownSchemaVersions: [],
  tools: [
    {
      name: "h_cert_resolve",
      description:
        "Free. Resolve whether a subject clears a caller's trust requirements at H-Cert. " +
        "Composes two vouches, fail-closed: the behavior-derived STANDING verdict and the " +
        "owner DELEGATION from the principal directory. A requirement is only enforced when " +
        "supplied; `ok` is the conjunction of every requirement present. Pass `subject` (the " +
        "CAIP-10 id being checked) and an optional `requirements` object: `minStanding` " +
        "(trusted|watch|unrated|suspended|revoked), `maxStalenessSec`, `externalBadges` " +
        "(string array), and `delegation` ({ delegatedBy: <owner CAIP-10>, scope?: <string> }) " +
        "to require a live owner->subject delegation. Returns { ok, standing, externalBadges, " +
        "reasons, failClosed, delegation }. Advisory only; never enforcing.",
      inputSchema: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "The subject being checked: a chain address or CAIP-10 account id.",
          },
          requirements: {
            type: "object",
            description:
              "Optional caller requirements. Each is enforced only when present; ok is their conjunction.",
            properties: {
              minStanding: {
                type: "string",
                enum: ["trusted", "watch", "unrated", "suspended", "revoked"],
                description: "Minimum acceptable standing tier.",
              },
              maxStalenessSec: {
                type: "number",
                description: "Max age of the standing verdict in seconds.",
              },
              externalBadges: {
                type: "array",
                items: { type: "string" },
                description: "Required external badge ids (KYA/AP2/DID).",
              },
              delegation: {
                type: "object",
                description:
                  "Require a live owner->subject delegation: the subject must be an active, " +
                  "unexpired principal delegated by `delegatedBy`, covering `scope` when given.",
                properties: {
                  delegatedBy: {
                    type: "string",
                    description: "The owner CAIP-10 that must have delegated to the subject.",
                  },
                  scope: {
                    type: "string",
                    description: "Optional scope the delegation must cover.",
                  },
                },
                required: ["delegatedBy"],
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
          now: {
            type: "number",
            description: "Optional evaluation time (unix seconds); defaults to now.",
          },
        },
        required: ["subject"],
        additionalProperties: false,
      },
      method: "POST",
      path: "/resolve",
      authMode: "free",
      bodyFromArgs: true,
    },
    {
      name: "h_cert_standing",
      description:
        "Free. Get the current signed STANDING verdict for a subject: an advisory, " +
        "behavior-backed read computed live from the H-Series signals. Returns the tier " +
        "(trusted|watch|unrated|suspended|revoked), rank, ruleset version, evidence, asOf, and " +
        "the operator signature. Standing is advisory, never enforcing; a verdict is a " +
        "point-in-time signal, not a guarantee. Pass `subject` (the CAIP-10 id).",
      inputSchema: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "The subject whose standing to read: a chain address or CAIP-10 account id.",
          },
        },
        required: ["subject"],
        additionalProperties: false,
      },
      method: "GET",
      // Single-segment route GET /standing/:subject. The subject is read whole by the
      // backend (c.req.param("subject")), so it maps via the default {subject} placeholder
      // (percent-encoded), NOT the raw {subject*} multi-segment form.
      path: "/standing/{subject}",
      authMode: "free",
    },
    {
      name: "h_cert_principals",
      description:
        "Free. List an owner's principal directory: the named grantees/counterparties the " +
        "owner has delegated to. Returns { owner, principals } where each principal is an " +
        "attested card (label, delegation, standing). Pass `owner` (the owner CAIP-10).",
      inputSchema: {
        type: "object",
        properties: {
          owner: {
            type: "string",
            description: "The owner CAIP-10 whose principal roster to list.",
          },
        },
        required: ["owner"],
        additionalProperties: false,
      },
      method: "GET",
      path: "/principals",
      authMode: "free",
    },
    {
      name: "h_cert_config",
      description:
        "Free. Get H-Cert configuration: the standing HCS topic id, ruleset version, read mode, " +
        "operator key id, and whether anchoring is on.",
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
