#!/usr/bin/env node
/**
 * Entry point. Dispatches to stdio or HTTP transport based on a
 * --transport flag (or the MCP_TRANSPORT env var).
 *
 * Usage:
 *   h-series-mcp --transport stdio   # for Claude Desktop config
 *   h-series-mcp --transport http    # for hosted Railway deploy
 *
 * Default is stdio so the npm-published entry-point Just Works when
 * Claude Desktop launches it.
 */

import { runStdio } from "./transport/stdio.js";
import { runHttp } from "./transport/http.js";
import { validateAllServices } from "./validate.js";
import { log } from "./logger.js";

function parseArgs(argv: string[]): { transport: "stdio" | "http"; port: number; skipValidate: boolean } {
  let transport: "stdio" | "http" =
    (process.env["MCP_TRANSPORT"] === "http" ? "http" : "stdio");
  let port = Number(process.env["PORT"] ?? "8080");
  let skipValidate = process.env["MCP_SKIP_VALIDATE"] === "1";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--transport" || a === "-t") {
      const v = argv[++i];
      if (v === "stdio" || v === "http") transport = v;
    } else if (a === "--port" || a === "-p") {
      port = Number(argv[++i] ?? port);
    } else if (a === "--skip-validate") {
      skipValidate = true;
    }
  }
  return { transport, port, skipValidate };
}

async function main(): Promise<void> {
  const { transport, port, skipValidate } = parseArgs(process.argv.slice(2));

  // Schema-discipline check. The logger writes to stderr on every transport,
  // so the JSON-RPC stdout stream stays clean without a per-transport switch.
  if (!skipValidate) {
    const results = await validateAllServices({ strict: false });
    for (const r of results) {
      if (r.errors.length) log.warn("schema validation errors", { service: r.service, errors: r.errors });
      if (r.warnings.length) log.info("schema validation warnings", { service: r.service, warnings: r.warnings });
    }
    const anyError = results.some((r) => r.errors.length);
    if (anyError && process.env["MCP_FAIL_ON_DRIFT"] === "1") {
      process.exit(2);
    }
  }

  if (transport === "stdio") {
    await runStdio();
  } else {
    await runHttp(port);
  }
}

main().catch((e) => {
  log.error("fatal", { detail: (e as Error).message, stack: (e as Error).stack });
  process.exit(1);
});
