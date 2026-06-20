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

export interface DispatchOptions {
  /** Override base URLs (useful for tests pointing at localhost). */
  baseUrlOverride?: (serviceId: string) => string | undefined;
  /**
   * Identity string put on the User-Agent header so service-side logs
   * can distinguish MCP traffic from direct API users.
   */
  userAgent?: string;
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

  // Run the request. The MCP SDK gives us 30+ seconds of headroom on
  // most clients; we cap at 60s here so an upstream stall surfaces as
  // a timeout error instead of hanging the MCP session forever.
  const ctl = new AbortController();
  const timeoutId = setTimeout(() => ctl.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(url, { method: tool.method, headers, body, signal: ctl.signal });
  } finally {
    clearTimeout(timeoutId);
  }

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
      throw new Error(`upstream ${res.status}`);
    }
    if (res.status === 402) {
      return {
        _error: true,
        status: 402,
        response: redact(parsed),
        hint: "This endpoint requires x402 payment. Provide a base64-encoded x402 envelope as payment_signature.",
      };
    }
    log.warn("upstream 4xx", { tool: toolName, service: service.id, status: res.status, body: redact(parsed) });
    return {
      _error: true,
      status: res.status,
      response: relayable4xx(parsed),
    };
  }
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
