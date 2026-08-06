/**
 * Tool dispatcher: receives an MCP tool call, looks up the owning
 * service + tool, builds the underlying HTTP request, forwards the
 * response.
 *
 * Auth model (per-tool, see ToolDef.authMode):
 *
 *   inline_x402   - caller passes payment_signature in tool args; the
 *                   dispatcher forwards it as the x-payment header.
 *                   Standard x402 envelope; per-call fee settled inline
 *                   via the x402 facilitator.
 *
 *   free          - no payment ever. Reserved for pure-metadata
 *                   wrappers and health endpoints.
 *
 * (No operator-issued bypass: underlying services have no dev-bypass
 * header; pay or use the admin Bearer token directly against the API.)
 */

import { findToolOwner } from "./services/index.js";
import { SERVER_VERSION } from "./version.js";
import { log, redact } from "./logger.js";
import { getAuditSink, type AuditBucket, type AuditFields } from "./modules/auditEmit.js";
import { hashIp, truncateIp } from "./modules/ipHash.js";
import { postActivity } from "./modules/activityEmit.js";

export interface DispatchOptions {
  /** Override base URLs (useful for tests pointing at localhost). */
  baseUrlOverride?: (serviceId: string) => string | undefined;
  /**
   * Identity string put on the User-Agent header so service-side logs
   * can distinguish MCP traffic from direct API users.
   */
  userAgent?: string;
  /**
   * Raw caller IP (req.ip on the HTTP transport; undefined on stdio, which is
   * single-tenant local). Used ONLY to derive the privacy-safe ipHash/ipPrefix
   * fields on the audit event and the raw op-log line. It is NEVER placed on the
   * public audit topic in raw form; see src/modules/ipHash.ts.
   */
  callerIp?: string;
  /**
   * Override the audit sink (tests). Defaults to the process-wide sink built from
   * the environment. The default is log-only until the audit vars are set.
   */
  auditSink?: { emit(e: {
    evt: string;
    bucket: AuditBucket;
    severity: "page" | "alert" | "review";
    fields?: AuditFields;
    scope?: "operator" | "tenant";
    subject?: string;
  }): Promise<void> };
}

// Best-effort caller identity for the audit `subject`. There is NO authenticated
// principal on this passthrough (only IP + whatever the caller put in the body), so this
// is an UNVERIFIED, self-asserted CAIP-10-shaped hint pulled from conventional owner/account
// arg names. It must be treated as a claim, never as proof of identity, and it never gates
// anything. A CAIP-10 id has the form chain:network:reference; we only surface a value that
// looks like one so the subject slice stays a coarse, self-labelled bucket.
const SUBJECT_ARG_NAMES = ["owner", "ownerAccountId", "account", "accountId", "caller", "subject"];
const CAIP10_SHAPE = /^[a-z0-9]+:[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/;
function bestEffortSubject(args: Record<string, unknown>): string | undefined {
  for (const name of SUBJECT_ARG_NAMES) {
    const v = args[name];
    if (typeof v === "string" && CAIP10_SHAPE.test(v)) return v;
  }
  return undefined;
}

/**
 * Run a single tool call. Throws on missing tool / network error /
 * non-2xx upstream response. Caller (the MCP server adapter) is
 * responsible for catching and converting to an MCP-shaped error.
 */
export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  opts: DispatchOptions = {},
): Promise<unknown> {
  const owner = findToolOwner(toolName);
  if (!owner) {
    throw new Error(`unknown tool: ${toolName}`);
  }
  const { service, tool } = owner;
  const baseUrl = opts.baseUrlOverride?.(service.id) ?? service.baseUrl;

  // Substitute path params (e.g. /receipt/{receipt_id}) from args.
  // A trailing `*` ({id*}) means substitute RAW, preserving forward slashes, for a
  // value that is itself a multi-segment route key (H-Index's "topicId/seq" id maps
  // onto the two-segment /endpoints/:topicId/:seq detail route). The default form
  // percent-encodes, which is correct for a single-segment param the backend reads
  // whole (H-Pact's "topicId/seq" ringId on /rings/:ringId wants the %2F form).
  let path = tool.path;
  const consumedPathArgs = new Set<string>();
  path = path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)(\*?)\}/g, (_, key: string, raw: string) => {
    if (!(key in args)) {
      throw new Error(
        `tool ${toolName} requires path parameter ${key}, missing from args`,
      );
    }
    consumedPathArgs.add(key);
    const value = String(args[key]);
    if (!raw) return encodeURIComponent(value);
    // Raw form: encode each segment but keep the separators, so a slash routes and
    // any other reserved character in a segment is still escaped. Reject traversal
    // segments (., .., empty) so a path param cannot climb out of its tool's route
    // (e.g. an id of "../../admin" reaching a sibling backend route).
    const segments = value.split("/");
    if (segments.some((s) => s === "" || s === "." || s === "..")) {
      throw new Error(`tool ${toolName} path parameter ${key} has an invalid segment: ${value}`);
    }
    return segments.map(encodeURIComponent).join("/");
  });

  // Strip args reserved for transport-level concerns (payment_signature)
  // AND args already consumed by path params. What remains is the
  // actual API payload.
  const stripSet = new Set<string>([
    ...(tool.stripArgs ?? []),
    ...Object.values(tool.headerArgs ?? {}),
    "payment_signature",
  ]);
  const apiArgs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (consumedPathArgs.has(k) && !tool.keepPathParamsInBody) continue;
    if (stripSet.has(k)) continue;
    apiArgs[k] = v;
  }

  // Auth resolution. The caller supplies payment_signature, which we
  // forward as the x-payment header on inline_x402 tools.
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": opts.userAgent ?? `h-series-mcp/${SERVER_VERSION}`,
  };

  const callerPaymentSig = stringArg(args.payment_signature);

  if (tool.authMode === "inline_x402" && callerPaymentSig) {
    assertValidPaymentSignature(callerPaymentSig);
    headers["x-payment"] = callerPaymentSig;
  }

  // Map any declared headerArgs onto request headers (e.g. a signed-read proof
  // as X-Authorization). Objects are JSON-stringified; the arg was stripped from
  // the body/query above.
  for (const [headerName, argName] of Object.entries(tool.headerArgs ?? {})) {
    const v = args[argName];
    if (v !== undefined && v !== null) {
      headers[headerName] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }

  // Inject any declared service-to-service secret header from the ENVIRONMENT
  // (never from caller args). The secret gates the H-Agent research surface: the
  // passthrough presents this bearer AFTER the x402 leg above so the backend runs
  // the paid work. Read at call time so an operator can rotate the secret without
  // a rebuild. A tool declaring this is only registered when the env var is set,
  // so an empty value here is a defensive skip, not the normal path. The value is
  // set as a header only; it is never placed in a body, a query, a log line, or an
  // audit field.
  for (const [headerName, spec] of Object.entries(tool.secretHeaderEnv ?? {})) {
    const secret = process.env[spec.env];
    if (secret) {
      headers[headerName] = `${spec.prefix ?? ""}${secret}`;
    }
  }
  // No auth supplied for an inline_x402 tool? Fire the request anyway
  // so the caller gets the real 402 challenge back from the underlying
  // service. The MCP server is a transparent proxy, not an enforcer.
  // free tools fall through with no x-payment header.

  // Build the request URL (query for GET, body for POST).
  let url = baseUrl + path;
  let body: string | undefined;
  if (tool.method === "GET") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(apiArgs)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  } else if (tool.method === "POST") {
    if (tool.bodyFromArgs) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(apiArgs);
    }
  }

  // Audit context. The sink is the process-wide one unless a test injects its own.
  // A tenant scope is used only when a self-asserted (unverified) subject is present;
  // otherwise the event is operator-scoped infra activity.
  const sink = opts.auditSink ?? getAuditSink();
  const subject = bestEffortSubject(args);
  // Privacy: the raw IP is hashed/truncated for the public plane here and NEVER emitted
  // raw. The raw IP appears only in the stderr op-log line below (local operator surface).
  const auditBase = (): AuditFields => ({
    tool: toolName,
    service: service.id,
    route: tool.path,
    ipHash: opts.callerIp ? hashIp(opts.callerIp) : "none",
    ipPrefix: opts.callerIp ? truncateIp(opts.callerIp) : "none",
  });
  const emit = (
    evt: string,
    bucket: AuditBucket,
    extra: AuditFields,
  ): void => {
    // Fire-and-forget: an audit emission must never block or fail the tool call.
    void sink.emit({
      evt,
      bucket,
      severity: "review",
      scope: subject ? "tenant" : "operator",
      ...(subject ? { subject } : {}),
      fields: { ...auditBase(), ...extra },
    });
    // Option (c): also record every call in the queryable H-Index agent-activity trace (the
    // "what did this agent call" record), kept OFF the on-chain SIEM topic. Fire-and-forget,
    // env-gated; the IP is already hashed by auditBase(). status collapses to ok|error.
    const base = auditBase();
    const latency = typeof extra["latencyMs"] === "number" ? (extra["latencyMs"] as number) : undefined;
    postActivity({
      product: "h-series-mcp",
      kind: "tool_call",
      tool: toolName,
      route: tool.path,
      status: evt.endsWith("_failed") ? "error" : "ok",
      ...(latency !== undefined ? { latencyMs: latency } : {}),
      ...(base.ipHash !== "none" ? { ipHash: String(base.ipHash) } : {}),
      ...(base.ipPrefix !== "none" ? { ipPrefix: String(base.ipPrefix) } : {}),
      ...(subject ? { subject } : {}),
    });
  };
  // Raw-IP op-log line (stderr only, redacted logger). This is the sole place the raw
  // caller IP is recorded; it must not reach the audit sink in raw form.
  if (opts.callerIp) {
    log.debug("tool call", { tool: toolName, service: service.id, ip: opts.callerIp });
  }

  // Run the request. The MCP SDK gives us 30+ seconds of headroom on
  // most clients; we cap at 60s here so an upstream stall surfaces as
  // a timeout error instead of hanging the MCP session forever.
  const startedAt = Date.now();
  const ctl = new AbortController();
  const timeoutId = setTimeout(() => ctl.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(url, { method: tool.method, headers, body, signal: ctl.signal });
  } catch (err) {
    // Network error / timeout: the upstream did not answer. Record it as a service
    // failure before rethrowing so the trace is not lost on the error path.
    emit("mcp.tool_call_failed", "service_failure", { latencyMs: Date.now() - startedAt, status: 0 });
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  const latencyMs = Date.now() - startedAt;

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  // Non-2xx handling. Three tiers, narrowing what is relayed to the caller:
  //
  //   402  - the x402 payment challenge. Relay the full redacted body so the
  //          LLM can reason over the structured challenge and retry with a
  //          payment_signature. This is the load-bearing transparent-proxy
  //          case and the only shape we forward whole.
  //   4xx  - other client errors (400/401/403/404/409/422...). Relay ONLY a
  //          bounded allowlist of conventional error fields after redaction;
  //          drop the rest. redact() scrubs by key name only and cannot find a
  //          secret echoed inside a generically-named field, so forwarding a
  //          backend-controlled 4xx body verbatim is the residual leak this
  //          closes. Unknown-shaped 4xx bodies collapse to just the status.
  //   5xx  - never relay the body. It can carry a stack trace, an unmasked
  //          identifier, or echoed request data. Log redacted server-side and
  //          throw a generic status so server.ts surfaces isError:true.
  if (!res.ok) {
    if (res.status >= 500) {
      log.warn("upstream 5xx", { tool: toolName, service: service.id, status: res.status, body: redact(parsed) });
      // Upstream error: a 5xx is a service failure of the backend, not caller intent.
      emit("mcp.tool_call_failed", "service_failure", { latencyMs, status: res.status });
      throw new Error(`upstream ${res.status}`);
    }
    if (res.status === 402) {
      // 402 is the expected payment challenge, not a failure: record it as activity so
      // the trace shows the caller reached a paid tool without a valid envelope.
      emit("mcp.tool_call", "activity", { latencyMs, status: 402 });
      return {
        _error: true,
        status: 402,
        response: redact(parsed),
        hint: "This endpoint requires x402 payment. Provide a base64-encoded x402 envelope as payment_signature.",
      };
    }
    log.warn("upstream 4xx", { tool: toolName, service: service.id, status: res.status, body: redact(parsed) });
    // A non-402 4xx is a rejected request: a bad/forbidden/not-found call. Treat it as
    // suspicious-activity signal (401/403/404/409/422...) so abuse patterns surface.
    emit("mcp.tool_call_failed", "malicious_suspicious", { latencyMs, status: res.status });
    return {
      _error: true,
      status: res.status,
      response: relayable4xx(parsed),
    };
  }
  // Success: one activity trace per resolved tool call.
  emit("mcp.tool_call", "activity", { latencyMs, status: res.status });
  return parsed;
}

function stringArg(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// Conventional error fields a backend 4xx carries that a caller actually needs
// to reason over (and retry). Anything outside this set on a non-402 4xx is
// dropped rather than relayed: redact() scrubs by key name only, so a secret
// echoed under a generic field (data, result, ...) would otherwise pass to the
// caller. Values are still run through redact() in case a backend nests a
// sensitive-keyed field under one of these.
const RELAYABLE_4XX_FIELDS = new Set(["error", "code", "message", "detail", "details"]);

/**
 * Reduce a non-402 4xx body to the allowlisted error fields. A non-object body
 * (a bare string or array) is not forwarded; the caller still gets the status.
 * Returns undefined when nothing allowlisted is present so the response is just
 * the status code.
 */
function relayable4xx(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (RELAYABLE_4XX_FIELDS.has(k.toLowerCase())) {
      out[k] = redact(v);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// An x402 envelope is a base64 (standard or url-safe) JSON blob. A real
// envelope (scheme + network + a signed authorization) is on the order of a
// few hundred bytes to low kilobytes; 64 KB is generous headroom while still
// bounding what we copy into a request header. We validate before forwarding
// rather than relying on the HTTP client to throw on a malformed value: this
// keeps a multi-megabyte string or control-character payload off the wire and
// gives the caller a clear error instead of an opaque dispatch failure.
const PAYMENT_SIG_MAX_LEN = 64 * 1024;
const BASE64_ENVELOPE = /^[A-Za-z0-9+/_-]+={0,2}$/;

export class InvalidPaymentSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPaymentSignatureError";
  }
}

/**
 * Reject a payment_signature that is not a plausible base64 x402 envelope
 * before it is set as the x-payment header. Bounds length and constrains the
 * charset (no control characters, no CR/LF that could split headers). The
 * backend remains the authority on whether the envelope actually settles.
 */
export function assertValidPaymentSignature(value: string): void {
  if (value.length > PAYMENT_SIG_MAX_LEN) {
    throw new InvalidPaymentSignatureError(
      `payment_signature exceeds the ${PAYMENT_SIG_MAX_LEN}-byte limit`,
    );
  }
  if (!BASE64_ENVELOPE.test(value)) {
    throw new InvalidPaymentSignatureError(
      "payment_signature must be a base64-encoded x402 envelope",
    );
  }
}
