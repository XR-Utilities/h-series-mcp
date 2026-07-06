/**
 * Price-cache behavior: cents formatting, the fallback path (no live fetch), a
 * live override from a stubbed /config (including a nested `pricing.*` field),
 * and the fail-safe (a bad/missing field keeps the fallback). The paid-tool
 * descriptions read through priceUsd(), so this locks the value they interpolate.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { ServiceDef } from "./types.js";
import { formatUsd, priceCents, priceUsd, initPrices, resetPricesForTest } from "./prices.js";

const realFetch = globalThis.fetch;

test("formatUsd renders whole cents as a two-decimal dollar amount", () => {
  assert.equal(formatUsd(5), "0.05");
  assert.equal(formatUsd(10), "0.10");
  assert.equal(formatUsd(500), "5.00");
  assert.equal(formatUsd(1000), "10.00");
});

test("fallback: with no live fetch, prices are the hardcoded defaults", () => {
  resetPricesForTest();
  assert.equal(priceCents("h_scope_scan"), 10);
  assert.equal(priceUsd("h_scope_scan"), "0.10");
  assert.equal(priceUsd("h_index_register"), "10.00");
  assert.equal(priceUsd("h_seal_anchor"), "0.05");
});

test("live: initPrices reads top-level and nested pricing fields, ignoring bad ones", async () => {
  resetPricesForTest();
  const configs: Record<string, unknown> = {
    "https://h-scope.test/config": { pricing: { scanPriceUsdCents: 25 } }, // nested
    "https://h-index.test/config": { registrationPriceUsdCents: 1500, renewalPriceUsdCents: "nope" }, // one bad
    "https://h-gate.test/config": { inspectPriceUsdCents: 10 },
  };
  globalThis.fetch = (async (url: string) => {
    const body = configs[String(url)];
    if (body === undefined) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const services = [
    { id: "h-scope", label: "H-Scope", baseUrl: "https://h-scope.test", manifestUrl: "https://h-scope.test/config", knownSchemaVersions: [], tools: [] },
    { id: "h-index", label: "H-Index", baseUrl: "https://h-index.test", manifestUrl: "https://h-index.test/config", knownSchemaVersions: [], tools: [] },
    { id: "h-gate", label: "H-Gate", baseUrl: "https://h-gate.test", manifestUrl: "https://h-gate.test/config", knownSchemaVersions: [], tools: [] },
  ] as ServiceDef[];

  try {
    await initPrices(services);
    // Nested field picked up live.
    assert.equal(priceUsd("h_scope_scan"), "0.25");
    // Valid top-level field picked up live.
    assert.equal(priceUsd("h_index_register"), "15.00");
    // Invalid field type keeps the fallback.
    assert.equal(priceCents("h_index_renew"), 500);
    // A service not passed in keeps its fallback (fetch never ran).
    assert.equal(priceCents("h_seal_anchor"), 5);
  } finally {
    globalThis.fetch = realFetch;
    resetPricesForTest();
  }
});

test("fail-safe: a failed fetch never throws and keeps the fallback", async () => {
  resetPricesForTest();
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  const services = [
    { id: "h-gate", label: "H-Gate", baseUrl: "https://h-gate.test", manifestUrl: "https://h-gate.test/config", knownSchemaVersions: [], tools: [] },
  ] as ServiceDef[];
  try {
    await assert.doesNotReject(() => initPrices(services));
    assert.equal(priceUsd("h_gate_inspect"), "0.10");
  } finally {
    globalThis.fetch = realFetch;
    resetPricesForTest();
  }
});
