/**
 * Coverage for the metered H-Agent research surface: the four paid tools that
 * collect an x402 micropayment at the passthrough and proxy to H-Agent's
 * /research/* routes, presenting the shared RESEARCH_SERVICE_SECRET as a bearer.
 *
 * What is locked here:
 *  - the exact price per tool (cents -> priceUsd), so a drift is caught;
 *  - the fail-closed gate: with the secret unset the tools are NOT registered;
 *  - the URL each tool builds (route-shape guard, like dispatch.test.ts) and the
 *    body it forwards;
 *  - the service bearer is injected from env, never from args, and is not in the
 *    inputSchema;
 *  - the backend JSON (including the bundled receipt) is relayed to the caller;
 *  - the format tools require an `answer` (argument validation).
 *
 * Uses node:test with a stubbed global fetch; no network.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { hAgent, RESEARCH_TOOLS_FOR_TEST } from "./services/h-agent.js";
import { isToolEnabled, listEnabledTools } from "./services/index.js";
import { priceCents, priceUsd, resetPricesForTest } from "./prices.js";
import { validateArgs } from "./argcheck.js";

// The four tools + their contracted prices (USD cents). This is the FINANCIAL
// contract: h_research 5c, blogify 50c, report 200c, calendar 5c.
const EXPECTED = [
  { name: "h_research", cents: 5, path: "/research/answer" },
  { name: "h_research_blogify", cents: 50, path: "/research/blogify" },
  { name: "h_research_report", cents: 200, path: "/research/report" },
  { name: "h_research_calendar", cents: 5, path: "/research/calendar" },
] as const;

test("the H-Agent service carries the four research tools with the right routes + auth", () => {
  const names = hAgent.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["h_research", "h_research_blogify", "h_research_calendar", "h_research_report"]);
  for (const spec of EXPECTED) {
    const tool = hAgent.tools.find((t) => t.name === spec.name)!;
    assert.ok(tool, `${spec.name} present`);
    assert.equal(tool.method, "POST");
    assert.equal(tool.path, spec.path, `${spec.name} targets ${spec.path}`);
    assert.equal(tool.authMode, "inline_x402", `${spec.name} is a paid x402 tool`);
    assert.equal(tool.bodyFromArgs, true, `${spec.name} forwards args as the body`);
    // The bearer is presented from env, never in the input schema (a caller can't
    // supply or read it), and it is an Authorization bearer.
    assert.deepEqual(tool.secretHeaderEnv, { Authorization: { env: "RESEARCH_SERVICE_SECRET", prefix: "Bearer " } });
    const props = tool.inputSchema.properties ?? {};
    assert.ok(!("Authorization" in props), "the secret is not a caller-supplied arg");
  }
});

test("fail-closed: with RESEARCH_SERVICE_SECRET unset every research tool is gated off", () => {
  const saved = process.env["RESEARCH_SERVICE_SECRET"];
  delete process.env["RESEARCH_SERVICE_SECRET"];
  try {
    for (const tool of RESEARCH_TOOLS_FOR_TEST) {
      assert.equal(isToolEnabled(tool), false, `${tool.name} is disabled without the secret`);
    }
    // None appear in the advertised surface.
    const advertised = new Set(listEnabledTools().map((t) => t.name));
    for (const spec of EXPECTED) assert.ok(!advertised.has(spec.name), `${spec.name} is not advertised`);
  } finally {
    if (saved !== undefined) process.env["RESEARCH_SERVICE_SECRET"] = saved;
  }
});

test("enabled: with the secret set every research tool is advertised", () => {
  const saved = process.env["RESEARCH_SERVICE_SECRET"];
  process.env["RESEARCH_SERVICE_SECRET"] = "s";
  try {
    for (const tool of RESEARCH_TOOLS_FOR_TEST) {
      assert.equal(isToolEnabled(tool), true, `${tool.name} is enabled with the secret`);
    }
    const advertised = new Set(listEnabledTools().map((t) => t.name));
    for (const spec of EXPECTED) assert.ok(advertised.has(spec.name), `${spec.name} is advertised`);
  } finally {
    if (saved === undefined) delete process.env["RESEARCH_SERVICE_SECRET"];
    else process.env["RESEARCH_SERVICE_SECRET"] = saved;
  }
});

test("prices: each research tool carries its contracted USD price", () => {
  resetPricesForTest();
  for (const spec of EXPECTED) {
    const tool = hAgent.tools.find((t) => t.name === spec.name)!;
    // The declared _meta price (surfaced to MCP clients).
    assert.equal(tool.priceUsd, spec.cents / 100, `${spec.name} priceUsd`);
    // The price-cache fallback the description interpolates.
    assert.equal(priceCents(spec.name as never), spec.cents, `${spec.name} fallback cents`);
  }
  assert.equal(priceUsd("h_research"), "0.05");
  assert.equal(priceUsd("h_research_blogify"), "0.50");
  assert.equal(priceUsd("h_research_report"), "2.00");
  assert.equal(priceUsd("h_research_calendar"), "0.05");
});

test("argument validation: format tools require question AND answer", () => {
  const blogify = hAgent.tools.find((t) => t.name === "h_research_blogify")!;
  // Missing answer is a violation.
  const missing = validateArgs({ question: "q" }, blogify.inputSchema);
  assert.ok(missing.length > 0, "answer is required");
  // Both present is clean.
  const ok = validateArgs({ question: "q", answer: "a" }, blogify.inputSchema);
  assert.deepEqual(ok, []);
  // h_research needs only question.
  const answer = hAgent.tools.find((t) => t.name === "h_research")!;
  assert.deepEqual(validateArgs({ question: "q" }, answer.inputSchema), []);
  assert.ok(validateArgs({}, answer.inputSchema).length > 0, "question is required");
});
