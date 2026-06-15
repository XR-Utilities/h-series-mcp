/**
 * HTTP/SSE transport. Used when the MCP server runs as a hosted
 * service (Railway, etc.) that remote MCP clients connect to over
 * the network.
 *
 * Endpoints:
 *
 *   GET  /            - service banner + manifest pointer
 *   GET  /healthz     - liveness probe + service ping summary
 *   POST /mcp         - MCP JSON-RPC (streamable-http transport)
 *   GET  /mcp         - MCP JSON-RPC SSE (legacy clients)
 *
 * Auth: every paid tool call still requires the caller to provide
 * their own payment_signature in the tool args. The hosted endpoint
 * is a transparent proxy, NOT a subsidy. Rate-limited per-IP.
 */

import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "../server.js";
import { SERVICES, ALL_TOOLS } from "../services/index.js";
import { SERVER_VERSION } from "../version.js";
import { log } from "../logger.js";
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_WINDOW = 60; // generous; agents typically fire bursts
const RATE_BUCKET_PRUNE_MS = 5 * 60_000;

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();

function rateLimit(req: Request, res: Response): boolean {
  // Use req.ip, populated from XFF by Express only when `trust proxy`
  // is enabled (we set it below). Without that, an unauthenticated
  // caller could rotate XFF values to evade the per-IP limit.
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_PER_WINDOW) {
    res.status(429).json({ error: "rate_limited", retry_after_s: Math.ceil((bucket.resetAt - now) / 1000) });
    return false;
  }
  return true;
}

// Walk the bucket map periodically and drop entries whose window has
// long since expired. Prevents unbounded growth from churning IPs.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.resetAt < now) rateBuckets.delete(ip);
  }
}, RATE_BUCKET_PRUNE_MS).unref();

export async function runHttp(port: number): Promise<void> {
  const app = express();
  // Trust exactly one upstream proxy (Railway's edge). Lets req.ip
  // reflect the real client address from XFF while ignoring caller-
  // supplied XFF when the request didn't actually transit a proxy.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.json({
      service: "h-series-mcp",
      description:
        "MCP server for the H-Series product family (H-Index, H-Seal, H-Grant, H-Relay, H-Scope, H-Pact, H-Gate). Connect any MCP client to /mcp.",
      version: SERVER_VERSION,
      mcp_endpoint: "/mcp",
      manifest: "/agents.json",
      well_known_manifest: "/.well-known/agents.json",
      llms_discovery: "/llms.txt",
      docs: "https://github.com/XR-Utilities/h-series-mcp",
      portfolio: "https://xrpl-utilities.com",
    });
  });

  app.get("/healthz", async (_req, res) => {
    res.json({ status: "ok", service: "h-series-mcp", version: SERVER_VERSION });
  });

  // ---- Discovery surfaces for non-MCP-speaking crawlers ----
  // The /mcp endpoint speaks JSON-RPC (POST + SSE) and is invisible
  // to a regular HTTP crawler. These routes give an LLM crawler or
  // search engine something to chew on so the MCP server isn't a
  // discoverability black hole.

  const manifest = () => ({
    schema_version: SERVER_VERSION,
    name: "H-Series MCP",
    provider: "XR Utilities",
    description:
      "Model Context Protocol server exposing the H-Series product family " +
      "(H-Index, H-Seal, H-Grant, H-Relay, H-Scope, H-Pact, H-Gate) as " + ALL_TOOLS.length + " callable tools " +
      "for AI agents. Stateless passthrough proxy: callers supply their own " +
      "x402 payment envelope per tool call. Settled inline via the x402 " +
      "facilitator on Hedera; per-call fee lands on the " +
      "operator treasury wallet. The MCP server holds no wallets and takes no cut.",
    service_status: "live",
    endpoints: {
      base_url: "https://mcp.xr-utilities.ai",
      mcp: "/mcp",
      discovery: "/llms.txt",
      manifest: "/agents.json",
      well_known_manifest: "/.well-known/agents.json",
      health: "/healthz",
    },
    transports: ["stdio", "streamable-http"],
    tool_count: ALL_TOOLS.length,
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      auth_mode: t.authMode,
    })),
    underlying_services: SERVICES.map((s) => ({
      id: s.id,
      label: s.label,
      base_url: s.baseUrl,
      manifest_url: s.manifestUrl,
    })),
    homepage: "https://xrpl-utilities.com",
    repository: "https://github.com/XR-Utilities/h-series-mcp",
    license: "MIT",
  });

  app.get("/agents.json", (_req, res) => res.json(manifest()));
  app.get("/.well-known/agents.json", (_req, res) => res.json(manifest()));

  app.get("/llms.txt", (_req, res) => {
    const toolList = ALL_TOOLS.map((t) =>
      `- \`${t.name}\` [${t.authMode}]`,
    ).join("\n");
    const body = [
      "# H-Series MCP",
      "",
      "Model Context Protocol server exposing the H-Series product family",
      `(H-Index, H-Seal, H-Grant, H-Relay, H-Scope, H-Pact, H-Gate) as ${ALL_TOOLS.length} callable tools for AI agents.`,
      "Stateless passthrough proxy.",
      "Provider: XR Utilities.",
      "",
      "## Connect",
      "- Hosted (any MCP client, including Claude Desktop with HTTP support):",
      "  POST JSON-RPC + SSE to `https://mcp.xr-utilities.ai/mcp`",
      "- Local (Claude Desktop config):",
      "  ```",
      "  npm i @xr-utilities/h-series-mcp",
      "  npx @xr-utilities/h-series-mcp --transport stdio",
      "  ```",
      "",
      "## Tools",
      toolList,
      "",
      "## Auth model",
      "Each `inline_x402` tool requires the caller to pass `payment_signature` in",
      "tool args - a base64-encoded x402 envelope. The MCP server forwards it as",
      "the `x-payment` header on the underlying call. Per-call fee settled inline",
      "via the x402 facilitator. Accepts USDC, HBAR, ETH, XRP, SOL, RLUSD, XLM",
      "across five chains (Hedera, Base, XRPL, Solana, Stellar).",
      "",
      "## Discovery",
      "- Manifest:    https://mcp.xr-utilities.ai/agents.json",
      "- Source:      https://github.com/XR-Utilities/h-series-mcp",
      "- Portfolio:   https://xrpl-utilities.com",
      "",
      "## What this is NOT",
      "Not a wallet. Not a custodian. Not an editorial product. Not investment",
      "advice. The MCP server holds no wallets and takes no cut - same x402",
      "settlement model as direct API calls, just wrapped as MCP tools so AI",
      "agents can discover and use them via tool-completion.",
      "",
    ].join("\n");
    res.type("text/markdown; charset=utf-8").send(body);
  });

  app.get("/robots.txt", (_req, res) => {
    const body = [
      "# h-series-mcp is built to be discovered by AI agents and crawlers.",
      "# Machine-readable manifests: /agents.json, /.well-known/agents.json, /llms.txt",
      "# MCP JSON-RPC endpoint: /mcp",
      "User-agent: *",
      "Allow: /",
      "",
    ].join("\n");
    res.type("text/plain; charset=utf-8").send(body);
  });

  // Stateless mode: each /mcp request gets a fresh Server + Transport
  // pair. The MCP SDK's streamable-http transport, even with
  // sessionIdGenerator: undefined, doesn't reliably handle a shared
  // transport instance across multiple unrelated requests - the second
  // call returns 500 because the transport's internal state is still
  // tied to the first request. The recommended stateless pattern is
  // build-connect-handle-close per request. Cheap: the Server object
  // is just function pointers, no expensive state.
  app.all("/mcp", async (req, res) => {
    if (!rateLimit(req, res)) return;
    let transport: StreamableHTTPServerTransport | null = null;
    try {
      const mcpServer = buildServer({
        userAgent: `h-series-mcp/${SERVER_VERSION} (http)`,
      });
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      // Make sure the transport is torn down when the response closes,
      // so a long-running SSE stream doesn't leak file descriptors.
      res.on("close", () => {
        transport?.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      // Log the detail server-side; do not return it to the client. The
      // thrown message can carry an upstream status or internal context that
      // does not belong in a public error body.
      log.error("mcp handleRequest threw", { detail: (e as Error).message, stack: (e as Error).stack });
      if (!res.headersSent) {
        res.status(500).json({ error: "mcp_handle_failed" });
      }
    }
  });

  // Surface unhandled rejections in the dispatcher / SDK so we don't get
  // mystery 500s from Express's default error handler with no body.
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", { reason: reason instanceof Error ? reason.message : String(reason) });
  });

  app.listen(port, () => {
    log.info("listening", { port, transport: "http" });
  });
}
