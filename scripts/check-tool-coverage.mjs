#!/usr/bin/env node
/**
 * Tool + route coverage gate. The real surface of this MCP server is two things:
 * the 44 passthrough tool definitions (src/services/*.ts) and the handful of
 * Express HTTP routes (src/transport/http.ts). Tool routing has drifted before
 * (a tool pointed at the wrong backend path), so the tools are the high-value
 * surface. This gate enumerates both surfaces from source and fails if any tool
 * name or HTTP route is not accounted for in scripts/coverage.json, under either
 * `covered` (names a test) or `waived` (names a reason). It is the forcing
 * function that makes a NEW tool or route a CI failure until someone classifies
 * it, instead of shipping untested.
 *
 * Zero dependencies, plain Node ES module. Run: npm run coverage.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`coverage: FAIL ${msg}`);
  process.exit(1);
}

// --- Enumerate the Express HTTP routes from the transport source ---------------
const httpSrc = readFileSync(join(ROOT, "src/transport/http.ts"), "utf8");
const routeRe = /app\.(?:get|post)\(\s*"(\/[^"]*)"/g;
const routes = new Set();
for (const m of httpSrc.matchAll(routeRe)) routes.add(m[1]);

// --- Enumerate the tool names from the service definitions ---------------------
const servicesDir = join(ROOT, "src/services");
const toolNames = new Set();
for (const file of readdirSync(servicesDir)) {
  if (!file.endsWith(".ts") || file === "index.ts") continue;
  const src = readFileSync(join(servicesDir, file), "utf8");
  for (const m of src.matchAll(/name:\s*"(h_[a-z_]+)"/g)) toolNames.add(m[1]);
}

// --- Load the classification ---------------------------------------------------
let coverage;
try {
  coverage = JSON.parse(readFileSync(join(ROOT, "scripts/coverage.json"), "utf8"));
} catch (e) {
  fail(`could not read scripts/coverage.json: ${e.message}`);
}

function classifiedKeys(section) {
  const c = coverage?.[section]?.covered ?? {};
  const w = coverage?.[section]?.waived ?? {};
  return new Set([...Object.keys(c), ...Object.keys(w)]);
}

const classifiedTools = classifiedKeys("tools");
const classifiedRoutes = classifiedKeys("routes");

const missingTools = [...toolNames].filter((t) => !classifiedTools.has(t)).sort();
const missingRoutes = [...routes].filter((r) => !classifiedRoutes.has(r)).sort();

// Flag stale entries too: a classification for a tool/route that no longer
// exists in source hides drift just as surely as a missing one.
const staleTools = [...classifiedTools].filter((t) => !toolNames.has(t)).sort();
const staleRoutes = [...classifiedRoutes].filter((r) => !routes.has(r)).sort();

const problems = [];
if (missingTools.length) problems.push(`unclassified tools: ${missingTools.join(", ")}`);
if (missingRoutes.length) problems.push(`unclassified routes: ${missingRoutes.join(", ")}`);
if (staleTools.length) problems.push(`stale tool entries (not in source): ${staleTools.join(", ")}`);
if (staleRoutes.length) problems.push(`stale route entries (not in source): ${staleRoutes.join(", ")}`);

if (problems.length) {
  for (const p of problems) console.error(`  - ${p}`);
  fail(`${problems.length} coverage gap(s); classify in scripts/coverage.json under covered or waived.`);
}

const coveredTools = Object.keys(coverage.tools?.covered ?? {}).length;
const waivedTools = Object.keys(coverage.tools?.waived ?? {}).length;
const coveredRoutes = Object.keys(coverage.routes?.covered ?? {}).length;
const waivedRoutes = Object.keys(coverage.routes?.waived ?? {}).length;

console.log(
  `coverage: OK (${toolNames.size} tools, ${routes.size} routes; ` +
    `tools ${coveredTools} covered / ${waivedTools} waived, ` +
    `routes ${coveredRoutes} covered / ${waivedRoutes} waived)`,
);
