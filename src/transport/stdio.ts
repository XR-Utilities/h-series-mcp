/**
 * stdio transport. Used when Claude Desktop (or any MCP client that
 * launches the server as a subprocess) spawns this binary directly.
 *
 *   {
 *     "mcpServers": {
 *       "h-series": {
 *         "command": "npx",
 *         "args": ["-y", "@xr-utilities/h-series-mcp", "--transport", "stdio"]
 *       }
 *     }
 *   }
 *
 * Single-tenant: any pre-signed payment_signature the user supplies
 * lives on their machine, never leaves it.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "../server.js";
import { SERVER_VERSION } from "../version.js";

export async function runStdio(): Promise<void> {
  const server = buildServer({
    userAgent: `h-series-mcp/${SERVER_VERSION} (stdio)`,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until the client closes stdio.
}
