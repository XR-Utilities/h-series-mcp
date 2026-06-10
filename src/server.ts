import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ALL_TOOLS, SERVICES, findToolOwner } from "./services/index.js";
import { dispatchTool, type DispatchOptions } from "./dispatch.js";
import { validateArgs } from "./argcheck.js";
import { SERVER_VERSION } from "./version.js";

const SERVER_NAME = "h-series";

export function buildServer(opts: DispatchOptions = {}): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => {
      const pricing =
        t.authMode === "free"
          ? { paid: false as const, priceUsd: 0 }
          : { paid: true as const, priceUsd: t.priceUsd ?? 0, settlement: "x402_inline" };
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        _meta: { pricing },
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    // Validate args against the tool's declared inputSchema before anything
    // is forwarded to a backend. The Server request-handler path only checks
    // the JSON-RPC envelope, so without this an unknown or malformed field
    // would flow straight upstream. Backends remain the authoritative
    // validators; this is a defense-in-depth gate, returned as an MCP error.
    const owner = findToolOwner(req.params.name);
    if (owner) {
      const violations = validateArgs(args, owner.tool.inputSchema);
      if (violations.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                `h-series-mcp argument validation error for ${req.params.name}: ` +
                violations.map((v) => (v.path ? `${v.path}: ${v.message}` : v.message)).join("; "),
            },
          ],
        };
      }
    }

    try {
      const result = await dispatchTool(req.params.name, args, opts);
      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `h-series-mcp dispatch error: ${(e as Error).message}`,
          },
        ],
      };
    }
  });

  const resources = SERVICES.flatMap((s) => [
    {
      uri: `${s.baseUrl}/config`,
      mimeType: "application/json",
      name: `${s.label} config`,
      description: `Live configuration for ${s.label}: topic IDs, pricing, accepted payment methods.`,
    },
  ]);

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources,
  }));

  const allowedResourceUris = new Set(resources.map((r) => r.uri));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    if (!allowedResourceUris.has(uri)) {
      throw new Error(`unknown resource: ${uri}`);
    }
    const ctl = new AbortController();
    const tId = setTimeout(() => ctl.abort(), 10_000);
    try {
      const r = await fetch(uri, { signal: ctl.signal });
      const text = await r.text();
      return {
        contents: [
          {
            uri,
            mimeType: r.headers.get("content-type") ?? "application/json",
            text,
          },
        ],
      };
    } finally {
      clearTimeout(tId);
    }
  });

  return server;
}
