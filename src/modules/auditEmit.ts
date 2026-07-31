// SIEM audit-event emitter (H-Index docs/SIEM-ALERTING-PLAN.md). SELF-CONTAINED sibling
// emitter: signs an alertable event with the SHARED audit operator and anchors it to the
// SHARED audit topic. H-Index is the HUB that reindexes + serves the query; a sibling only
// EMITS. The canonical hash, the kind, and the payload shape here are BYTE-IDENTICAL to
// H-Index (src/modules/auditEvent.ts) and to the H-Gate sibling, so the hub verifies this
// product's events. DO NOT change the hashing, the kind, or the payload field set.
//
// This repo is a zero-dependency passthrough by design (only @modelcontextprotocol/sdk +
// express). The Hedera SDK is heavy and only needed to SIGN + ANCHOR, so it is loaded via
// a LAZY dynamic import on the first anchoring emit. With the audit vars unset the sink is
// log-only and never touches the SDK, so the passthrough still boots and runs with audit
// OFF even if @hiero-ledger/sdk is not installed (it is an optionalDependency).
import { createHash } from "node:crypto";
import { log } from "../logger.js";

// Product-neutral signing domain shared by every backend (the `product` field names
// the source). MUST equal H-Index AUDIT_EVENT_KIND.
export const AUDIT_EVENT_KIND = "h-series.audit-event";

export type AuditBucket =
  | "service_failure"
  | "incorrect_data"
  | "missing_data"
  | "malicious_suspicious"
  | "activity";
export type AuditSeverity = "page" | "alert" | "review";
export type AuditFields = Record<string, string | number | boolean>;

export type AuditScope = "operator" | "tenant";

export interface AuditEventInput {
  evt: string;
  bucket: AuditBucket;
  severity: AuditSeverity;
  fields?: AuditFields;
  // Two-plane scoping (matches the estate template + H-Index hub). Omit for operator/infra
  // events (the default). A tenant event sets scope: "tenant" + subject = the acting agent's
  // CAIP-10 / salted OIDC commitment (NEVER raw PII), so the hub serves it as that subject's
  // slice and the ABS scorer can attribute the risk event by subject.
  scope?: AuditScope;
  subject?: string;
}

// Canonical JSON: recursively sort object keys, then JSON.stringify. MUST stay
// byte-identical to @xr-utilities/signing canonicalJson (the hub verifies with it).
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}
function hashCanonicalJson(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(sortKeys(value))).digest();
}

export interface AuditSink {
  readonly anchoring: boolean;
  emit(input: AuditEventInput): Promise<void>;
}

export interface AuditSinkConfig {
  product: string; // this service's id, e.g. "h-series-mcp"
  auditOperatorId?: string;
  auditOperatorKey?: string; // ECDSA secp256k1 raw hex (the sealed AUDIT_OPERATOR_KEY)
  auditTopicId?: string;
  network: "mainnet" | "testnet";
}

// Minimal structural view of the Hedera SDK surface this module uses. The SDK is a
// dynamic import (see the file header), so it is not in the compiled type graph; these
// interfaces keep the anchoring path strictly typed without an `any`.
interface HederaClient {
  setOperator(id: unknown, key: unknown): HederaClient;
}
interface HederaPrivateKey {
  sign(bytes: Uint8Array): Uint8Array;
  readonly publicKey: { toStringDer(): string };
}
interface HederaTopicId {
  toString(): string;
}
interface HederaReceipt {
  status: { toString(): string };
}
interface HederaResponse {
  getReceipt(client: HederaClient): Promise<HederaReceipt>;
}
interface HederaSubmitTx {
  execute(client: HederaClient): Promise<HederaResponse>;
}
interface HederaSdk {
  AccountId: { fromString(s: string): unknown };
  Client: { forMainnet(): HederaClient; forTestnet(): HederaClient };
  PrivateKey: { fromStringECDSA(s: string): HederaPrivateKey };
  TopicId: { fromString(s: string): HederaTopicId };
  TopicMessageSubmitTransaction: new (opts: {
    topicId: HederaTopicId;
    message: string;
    maxChunks: number;
  }) => HederaSubmitTx;
}

interface AnchorState {
  client: HederaClient;
  topicId: HederaTopicId;
  auditKey: HederaPrivateKey;
  sdk: HederaSdk;
}

// Builds the sink. Anchoring is enabled only when all three audit vars are present;
// otherwise the sink is log-only (fail-safe, OFF by default). The Hedera SDK is loaded
// lazily on the first anchoring emit so the passthrough never imports it with audit OFF.
export function createAuditSink(cfg: AuditSinkConfig): AuditSink {
  const anchoring = Boolean(cfg.auditOperatorId && cfg.auditOperatorKey && cfg.auditTopicId);
  let state: AnchorState | null = null;
  let initFailed = false;
  let initInFlight: Promise<AnchorState | null> | null = null;

  async function ensureState(): Promise<AnchorState | null> {
    if (state) return state;
    if (initFailed) return null;
    if (initInFlight) return initInFlight;
    initInFlight = (async (): Promise<AnchorState | null> => {
      try {
        // Dynamic import so a missing @hiero-ledger/sdk only breaks the anchoring path,
        // not the whole passthrough. The specifier is held in a variable so TypeScript
        // does not statically resolve (and require) the module's types: it is an
        // optionalDependency, present only when anchoring is configured on the deploy.
        const sdkModule = "@hiero-ledger/sdk";
        const sdk = (await import(sdkModule)) as unknown as HederaSdk;
        const auditKey = sdk.PrivateKey.fromStringECDSA(cfg.auditOperatorKey!);
        const client = (cfg.network === "mainnet" ? sdk.Client.forMainnet() : sdk.Client.forTestnet())
          .setOperator(sdk.AccountId.fromString(cfg.auditOperatorId!), auditKey);
        const topicId = sdk.TopicId.fromString(cfg.auditTopicId!);
        state = { client, topicId, auditKey, sdk };
        return state;
      } catch (err) {
        initFailed = true;
        log.warn("audit anchoring init failed; degrading to log-only", {
          detail: err instanceof Error ? err.message : String(err),
        });
        return null;
      } finally {
        initInFlight = null;
      }
    })();
    return initInFlight;
  }

  return {
    anchoring,
    async emit(input: AuditEventInput): Promise<void> {
      try {
        const at = Math.floor(Date.now() / 1000);
        // Op-log line (stderr, redacted): the local observability trace, always emitted.
        log.info(`audit:${input.evt}`, {
          evt: input.evt,
          bucket: input.bucket,
          severity: input.severity,
          ...input.fields,
        });
        if (!anchoring) return;
        const st = await ensureState();
        if (!st) return;
        // Fixed field set (fields always present) so the digest is deterministic.
        // Payload shape MUST stay byte-identical to the H-Index hub (src/modules/auditEvent.ts)
        // and the estate template so the hub verifies every product's events: scope + subject
        // sit between severity and fields with the same operator/empty defaults.
        const payload = {
          v: 1,
          product: cfg.product,
          at,
          evt: input.evt,
          bucket: input.bucket,
          severity: input.severity,
          scope: input.scope ?? "operator",
          subject: input.subject ?? "",
          fields: input.fields ?? {},
        };
        const digest = hashCanonicalJson({ kind: AUDIT_EVENT_KIND, payload });
        const signature = Buffer.from(st.auditKey.sign(digest)).toString("hex");
        const signed = { ...payload, operatorPublicKey: st.auditKey.publicKey.toStringDer(), signature };
        const tx = new st.sdk.TopicMessageSubmitTransaction({
          topicId: st.topicId,
          message: JSON.stringify(signed),
          maxChunks: 40,
        });
        const resp = await tx.execute(st.client);
        const receipt = await resp.getReceipt(st.client);
        if (receipt.status.toString() !== "SUCCESS") {
          log.error("audit event anchor failed", {
            evt: "audit.anchor_failed",
            reason: receipt.status.toString(),
            target: input.evt,
          });
        }
      } catch (err) {
        // An audit emission must never propagate into the caller.
        log.warn("audit event emit failed (swallowed)", {
          detail: err instanceof Error ? err.message : String(err),
          target: input.evt,
        });
      }
    },
  };
}

// Reads the audit sink config from the environment. Kept here (not a shared config module,
// which this repo does not have) so the emitter is self-contained. HEDERA_NETWORK selects
// the anchor network; defaults to mainnet to match the live estate.
export function auditSinkConfigFromEnv(): AuditSinkConfig {
  const net = process.env["HEDERA_NETWORK"] === "testnet" ? "testnet" : "mainnet";
  return {
    product: "h-series-mcp",
    auditOperatorId: process.env["AUDIT_OPERATOR_ID"],
    auditOperatorKey: process.env["AUDIT_OPERATOR_KEY"],
    auditTopicId: process.env["HCS_AUDIT_TOPIC_ID"],
    network: net,
  };
}

// Process-wide sink, built once from the environment on first use (a Hedera Client and
// signing key are held for the anchoring path, so one instance is reused across calls).
let sharedSink: AuditSink | null = null;
export function getAuditSink(): AuditSink {
  if (!sharedSink) sharedSink = createAuditSink(auditSinkConfigFromEnv());
  return sharedSink;
}
