/**
 * Documentation drift gate. The doc analog of the route-coverage gate: it does not
 * judge prose, it catches the mechanical, feature-tied drift that a human review
 * misses. Zero-dependency plain Node.
 *
 *   npm run docs:check          # gate (hard-fails on real drift)
 *   npm run docs:check -- --warn-only   # never exit non-zero (advisory)
 *
 * HARD FAILS (a feature shipped without its doc surface):
 *   1. A file listed in scripts/docs-manifest.json `required` is missing.
 *   2. An env var the code consumes (a Zod config-schema key, or a process.env.X use)
 *      is absent from .env.example and not in the manifest `envIgnore`. A new config
 *      surface MUST be documented, the same way a new route must be classified.
 *
 * ADVISORY (printed, never fatal): .env.example keys no code consumes (orphans), and
 * the documented-vs-real endpoint count when scripts/route-coverage.json exists.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "scripts", "docs-manifest.json");
const WARN_ONLY = process.argv.includes("--warn-only");

const walk = (dir) => {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".js")) out.push(p);
  }
  return out;
};

if (!existsSync(MANIFEST)) {
  console.error(`missing ${MANIFEST} (add a docs manifest: required, configFiles, envIgnore)`);
  process.exit(1);
}
const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
const required = m.required ?? [];
const configFiles = m.configFiles ?? [];
const envIgnore = new Set(m.envIgnore ?? []);

const hard = [];
const warn = [];

// 1. Required docs present.
for (const f of required) {
  if (!existsSync(join(ROOT, f))) hard.push(`required doc missing: ${f}`);
}

// 2. Env surface documented. Collect env vars the code consumes: Zod config-schema
// keys (KEY: z.<...>) in the declared config files, plus any process.env.X uses.
const used = new Set();
for (const cf of configFiles) {
  const p = join(ROOT, cf);
  if (!existsSync(p)) {
    warn.push(`configFile not found (manifest stale?): ${cf}`);
    continue;
  }
  const text = readFileSync(p, "utf8");
  // An UPPER_SNAKE key followed by a validator (z.*, or a custom validator like
  // hederaAccountId(...) / evmAddress()) is an env-schema entry. Matching any
  // identifier/call after the colon (not just z.) catches custom validators, so
  // those keys are not mis-flagged as undocumented orphans.
  for (const mm of text.matchAll(/^\s*([A-Z][A-Z0-9_]+):\s*[a-zA-Z(]/gm)) used.add(mm[1]);
}
for (const f of walk(join(ROOT, "src"))) {
  const text = readFileSync(f, "utf8");
  for (const mm of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(mm[1]);
  for (const mm of text.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g)) used.add(mm[1]);
}

const envExamplePath = join(ROOT, ".env.example");
const documented = new Set();
if (existsSync(envExamplePath)) {
  for (const line of readFileSync(envExamplePath, "utf8").split("\n")) {
    const mm = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]+)=/);
    if (mm) documented.add(mm[1]);
  }
} else if (used.size > 0) {
  hard.push(".env.example missing but the code consumes env vars");
}

const missing = [...used].filter((k) => !documented.has(k) && !envIgnore.has(k)).sort();
for (const k of missing) hard.push(`env var consumed by code but not in .env.example: ${k}`);

const orphans = [...documented].filter((k) => !used.has(k) && !envIgnore.has(k)).sort();
if (orphans.length) warn.push(`.env.example keys no code consumes (stale?): ${orphans.join(", ")}`);

// 3. Advisory endpoint sanity (only when the route-coverage manifest exists).
const routeManifest = ["route-coverage.json", "smoke-coverage.json"]
  .map((f) => join(ROOT, "scripts", f))
  .find((p) => existsSync(p));
if (routeManifest) {
  const rm = JSON.parse(readFileSync(routeManifest, "utf8"));
  const routeCount = Object.keys(rm.covered ?? {}).length + Object.keys(rm.waived ?? {}).length;
  const readme = existsSync(join(ROOT, "README.md")) ? readFileSync(join(ROOT, "README.md"), "utf8") : "";
  const documentedPaths = new Set([...readme.matchAll(/`?(GET|POST|PUT|DELETE|PATCH)\s+(\/[a-zA-Z0-9/:._-]*)/g)].map((x) => `${x[1]} ${x[2]}`));
  if (documentedPaths.size > 0 && documentedPaths.size < routeCount / 2) {
    warn.push(`README documents ${documentedPaths.size} endpoints but the app registers ${routeCount} (API reference may be stale)`);
  }
}

for (const w of warn) console.log(`  warn: ${w}`);
if (hard.length === 0) {
  console.log(`docs: OK (${required.length} required present, ${used.size} env vars documented${warn.length ? `, ${warn.length} advisory` : ""})`);
  process.exit(0);
}
for (const h of hard) console.error(`  FAIL: ${h}`);
console.error(`\ndocs: FAIL (${hard.length} drift issue(s))`);
process.exit(WARN_ONLY ? 0 : 1);
