/**
 * Minimal structured logger. Zero-dependency on purpose: this server is a
 * lightweight public passthrough, and every dependency is a supply-chain
 * review, so a small logger beats pulling a logging framework in here.
 *
 * Writes JSON lines to stderr ONLY. On the stdio transport, stdout carries
 * the MCP JSON-RPC stream; writing a log line there would corrupt the
 * protocol. stderr is safe for both the stdio and HTTP transports, so the
 * logger never has to know which transport is running.
 *
 * Every field object is passed through redact() before it is written, so a
 * forwarded upstream error body, a caller's x402 payment envelope, or a
 * bearer token cannot land in a log line. redact() is also exported for
 * callers that need to scrub a value before it crosses a boundary (for
 * example an upstream response body relayed back to the client).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function thresholdFromEnv(): number {
  const raw = process.env["LOG_LEVEL"];
  if (raw && raw in ORDER) return ORDER[raw as LogLevel];
  return ORDER.info;
}
const threshold = thresholdFromEnv();

// Keys whose values are never safe to log or relay. Matched case-insensitively
// against the whole key. Covers payment envelopes, auth material, and the
// secret-bearing fields an upstream body might carry.
const SENSITIVE_KEY =
  /^(x[-_]?payment|payment[-_]?signature|authorization|x[-_]?admin[-_]?secret|admin[-_]?secret|cookie|set[-_]?cookie|api[-_]?key|secret|token|password|passphrase|private[-_]?key|seed|mnemonic|credential|client[-_]?secret)$/i;

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;

/**
 * Return a copy of `value` with any sensitive-keyed field replaced by
 * "[redacted]". Recurses into objects and arrays up to a bounded depth so a
 * hostile or malformed body cannot drive unbounded recursion. Non-object
 * values pass through unchanged: this scrubs by key, it does not try to find
 * secrets inside free-form strings (that is unreliable, so we avoid relaying
 * raw bodies in the first place; see dispatch.ts).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) {
    // At the depth cap, never emit an unscrubbed subtree: a sensitive-keyed
    // field nested past MAX_DEPTH would otherwise pass through verbatim,
    // defeating the redactor. Scalars are safe (we scrub by key, not content);
    // objects and arrays are truncated to a placeholder.
    if (Array.isArray(value) || (value && typeof value === "object")) return "[truncated]";
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const line: Record<string, unknown> = { level, msg, service: "h-series-mcp" };
  if (fields) Object.assign(line, redact(fields));
  // stderr, always: stdout is the JSON-RPC channel on the stdio transport.
  process.stderr.write(JSON.stringify(line) + "\n");
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>): void => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>): void => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>): void => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>): void => emit("error", msg, fields),
};
