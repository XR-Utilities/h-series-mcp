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
  let path = tool.path;
  const consumedPathArgs = new Set<string>();
  path = path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key: string) => {
    if (!(key in args)) {
      throw new Error(
        `tool ${toolName} requires path parameter ${key}, missing from args`,
      );
    }
    consumedPathArgs.add(key);
    return encodeURIComponent(String(args[key]));
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
    if (consumedPathArgs.has(k)) continue;
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

  // 4xx (including 402): soft-return so the LLM can reason over the
  // structured challenge and retry with a payment_signature.
  // 5xx: do not relay the upstream body to the caller. A 5xx body can carry
  // an internal stack trace, an unmasked identifier, or echoed request data;
  // forwarding it verbatim is the log-hygiene gap this closes. Log the
  // redacted body server-side for our own debugging and throw a generic
  // status so server.ts surfaces isError:true without the raw body.
  if (!res.ok) {
    if (res.status >= 500) {
      log.warn("upstream 5xx", { tool: toolName, service: service.id, status: res.status, body: redact(parsed) });
      throw new Error(`upstream ${res.status}`);
    }
    return {
      _error: true,
      status: res.status,
      // redact() scrubs any sensitive-keyed field an upstream 4xx might echo
      // (a payment envelope, a token) while leaving the structured challenge
      // an x402 402 carries intact.
      response: redact(parsed),
      hint:
        res.status === 402
          ? "This endpoint requires x402 payment. Provide a base64-encoded x402 envelope as payment_signature."
          : undefined,
    };
  }
  return parsed;
}

function stringArg(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
