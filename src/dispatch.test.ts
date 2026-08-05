/**
 * Tests for the tool dispatcher's security-relevant behavior: payment_signature
 * format validation, the bounded 4xx relay allowlist, the whole-body 402
 * passthrough, and the no-body 5xx path.
 *
 * Uses node:test plus a stubbed global fetch so no network is required.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  dispatchTool,
  assertValidPaymentSignature,
  InvalidPaymentSignatureError,
} from "./dispatch.js";

const realFetch = globalThis.fetch;

function stubFetch(status: number, body: unknown): () => void {
  const captured: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

test("h_index_resolve maps to GET /endpoints/resolve with uaid as a query param", async () => {
  let capturedUrl = "";
  const saved = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({ uaid: "u", resolved: { id: "0.0.1/2" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await dispatchTool("h_index_resolve", { uaid: "uaid:aid:abc;proto=mcp;nativeId=hedera:mainnet:0.0.1" });
    assert.match(capturedUrl, /\/endpoints\/resolve\?/, "hits the resolve route");
    assert.match(capturedUrl, /uaid=uaid%3Aaid%3Aabc/, "uaid is url-encoded query param, not a path segment");
  } finally {
    globalThis.fetch = saved;
  }
});

test("payment_signature: a clean base64 envelope is accepted", () => {
  assert.doesNotThrow(() => assertValidPaymentSignature("YWJjMTIzKy89"));
  assert.doesNotThrow(() => assertValidPaymentSignature("AbC-_d9="));
});

test("payment_signature: a control character is rejected", () => {
  assert.throws(
    () => assertValidPaymentSignature("abc\r\nX-Injected: 1"),
    InvalidPaymentSignatureError,
  );
});

test("payment_signature: an oversized value is rejected", () => {
  const huge = "A".repeat(64 * 1024 + 1);
  assert.throws(() => assertValidPaymentSignature(huge), InvalidPaymentSignatureError);
});

test("a non-402 4xx relays only allowlisted error fields", async () => {
  const restore = stubFetch(404, {
    error: "not found",
    code: "NOT_FOUND",
    data: "internal-id-should-not-leak",
    listingOwner: "should-not-leak",
  });
  try {
    const result = (await dispatchTool("h_index_get_listing", { id: "0.0.1/2" })) as {
      _error: boolean;
      status: number;
      response?: Record<string, unknown>;
    };
    assert.equal(result._error, true);
    assert.equal(result.status, 404);
    assert.deepEqual(Object.keys(result.response ?? {}).sort(), ["code", "error"]);
    assert.equal(result.response?.["error"], "not found");
  } finally {
    restore();
  }
});

test("a 402 challenge body is relayed whole (redacted)", async () => {
  const restore = stubFetch(402, {
    accepts: [{ scheme: "exact", network: "hedera:mainnet" }],
    x402Version: 1,
  });
  try {
    const result = (await dispatchTool("h_index_register", {
      apiName: "x",
      endpointUrl: "https://x",
      description: "d",
      pricing: "{}",
      ownerAccountId: "hedera:mainnet:0.0.1",
      registryTopicId: "0.0.1",
      issuedAt: 1,
      signature: "0xabc",
    })) as { _error: boolean; status: number; response?: Record<string, unknown> };
    assert.equal(result.status, 402);
    assert.ok(result.response?.["accepts"], "402 challenge fields pass through");
  } finally {
    restore();
  }
});

test("a 5xx body is not relayed; a generic error is thrown", async () => {
  const restore = stubFetch(500, { stack: "secret trace", data: "leak" });
  try {
    await assert.rejects(
      () => dispatchTool("h_index_get_listing", { id: "0.0.1/2" }),
      /upstream 500/,
    );
  } finally {
    restore();
  }
});

// ─── Route-shape guards ───────────────────────────────────────────────────
// These lock the exact upstream URL each tool builds. The startup validator only
// substring-checks a tool's path against the manifest, so it cannot catch a tool
// that targets the WRONG route shape (e.g. /endpoints?id= silently returning the
// recent feed instead of the /endpoints/:topicId/:seq detail). Asserting the built
// URL here is the guard that does.

function captureUrl(status: number, body: unknown): { restore: () => void; get: () => string } {
  const cap: { url: string } = { url: "" };
  globalThis.fetch = (async (url: string) => {
    cap.url = String(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = realFetch; }, get: () => cap.url };
}

test("h_index_get_listing targets the two-segment detail route with a literal slash", async () => {
  const f = captureUrl(200, { id: "0.0.10601198/113" });
  try {
    await dispatchTool("h_index_get_listing", { id: "0.0.10601198/113" });
    // Must hit /endpoints/<topic>/<seq> (literal slash), NOT ?id= and NOT a %2F-encoded
    // single segment. ?id= is ignored by the backend and returns the recent feed.
    assert.equal(f.get(), "https://h-index.xr-utilities.ai/endpoints/0.0.10601198/113");
    assert.ok(!f.get().includes("?id="), "must not fall back to the ignored ?id= query");
    assert.ok(!f.get().includes("%2F"), "the route separator must stay a literal slash");
  } finally {
    f.restore();
  }
});

test("h_index_get_listing rejects a path-traversal id before any request fires", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => dispatchTool("h_index_get_listing", { id: "../../admin" }),
      /invalid segment/,
    );
    assert.equal(called, false, "a traversal id must not reach the backend");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("h_pact_get_ring keeps the single-segment encoded form (%2F)", async () => {
  const f = captureUrl(200, { ringId: "0.0.10587224/2" });
  try {
    await dispatchTool("h_pact_get_ring", { ringId: "0.0.10587224/2" });
    // H-Pact's /rings/:ringId reads the whole id as ONE segment, so the slash must be
    // percent-encoded. This is the inverse of h_index_get_listing; the guard prevents a
    // future "preserve slashes everywhere" change from breaking this route.
    assert.equal(f.get(), "https://h-pact.xr-utilities.ai/rings/0.0.10587224%2F2");
  } finally {
    f.restore();
  }
});

test("h_cert_standing encodes the CAIP-10 subject as one whole segment", async () => {
  const f = captureUrl(200, { tier: "unrated", rank: 1 });
  try {
    await dispatchTool("h_cert_standing", { subject: "hedera:mainnet:0.0.10490145" });
    // GET /standing/:subject reads the subject whole (c.req.param), so the CAIP-10
    // colons are percent-encoded into a single path segment; no literal slash routes.
    assert.equal(
      f.get(),
      "https://h-cert.xr-utilities.ai/standing/hedera%3Amainnet%3A0.0.10490145",
    );
  } finally {
    f.restore();
  }
});

test("h_index_risk_events encodes the CAIP-10 subject as one whole segment", async () => {
  const f = captureUrl(200, { subject: "hedera:mainnet:0.0.10490145", events: [] });
  try {
    await dispatchTool("h_index_risk_events", { subject: "hedera:mainnet:0.0.10490145" });
    // GET /risk-events/:subject reads the subject whole (c.req.param), so the CAIP-10
    // colons are percent-encoded into a single path segment; no literal slash routes.
    // Mirrors h_cert_standing, the inverse of h_index_get_listing's two-segment {id*}.
    assert.equal(
      f.get(),
      "https://h-index.xr-utilities.ai/risk-events/hedera%3Amainnet%3A0.0.10490145",
    );
    assert.ok(!f.get().includes("?subject="), "subject must route as a path segment, not a query");
  } finally {
    f.restore();
  }
});

test("h_index_risk_events forwards limit as a query param on the subject route", async () => {
  const f = captureUrl(200, { subject: "hedera:mainnet:0.0.1", events: [] });
  try {
    await dispatchTool("h_index_risk_events", { subject: "hedera:mainnet:0.0.1", limit: 50 });
    const url = new URL(f.get());
    // pathname keeps the percent-encoded CAIP-10 colons (one whole segment).
    assert.equal(url.pathname, "/risk-events/hedera%3Amainnet%3A0.0.1");
    assert.equal(url.searchParams.get("limit"), "50");
  } finally {
    f.restore();
  }
});

test("h_cert_resolve posts the requirements body to /resolve", async () => {
  const cap: { url: string; init?: RequestInit } = { url: "" };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    cap.url = String(url);
    cap.init = init;
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await dispatchTool("h_cert_resolve", {
      subject: "hedera:mainnet:0.0.1",
      requirements: { minStanding: "watch", delegation: { delegatedBy: "hedera:mainnet:0.0.2" } },
    });
    assert.equal(cap.url, "https://h-cert.xr-utilities.ai/resolve");
    assert.equal(cap.init?.method, "POST");
    const sent = JSON.parse(String(cap.init?.body));
    assert.equal(sent.subject, "hedera:mainnet:0.0.1");
    assert.equal(sent.requirements.minStanding, "watch");
    assert.equal(sent.requirements.delegation.delegatedBy, "hedera:mainnet:0.0.2");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("h_index_search forwards the trust-tier filters as query params", async () => {
  const f = captureUrl(200, { mode: "semantic", results: [] });
  try {
    await dispatchTool("h_index_search", {
      q: "registry",
      trust: "observed_any",
      excludeFlags: "drift,vuln",
      paid: "open",
      tags: "data",
      sort: "popular",
    });
    const url = new URL(f.get());
    assert.equal(url.pathname, "/endpoints");
    assert.equal(url.searchParams.get("trust"), "observed_any");
    assert.equal(url.searchParams.get("excludeFlags"), "drift,vuln");
    assert.equal(url.searchParams.get("paid"), "open");
    assert.equal(url.searchParams.get("tags"), "data");
    assert.equal(url.searchParams.get("sort"), "popular");
  } finally {
    f.restore();
  }
});

test("an invalid payment_signature surfaces before any request fires", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        dispatchTool("h_scope_scan", {
          subject: "0xabc",
          payment_signature: "bad\nvalue",
        }),
      InvalidPaymentSignatureError,
    );
    assert.equal(called, false, "no upstream request on a rejected signature");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- audit observability + IP privacy ----

import { hashIp, truncateIp } from "./modules/ipHash.js";

interface CapturedEvent {
  evt: string;
  bucket: string;
  severity: string;
  fields?: Record<string, unknown>;
  scope?: string;
  subject?: string;
}
function captureSink(): { sink: { emit(e: CapturedEvent): Promise<void> }; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  return {
    events,
    sink: {
      async emit(e: CapturedEvent): Promise<void> {
        events.push(e);
      },
    },
  };
}

test("a successful call emits mcp.tool_call (activity) with a privacy-safe ip", async () => {
  const restore = stubFetch(200, { categories: [] });
  const { sink, events } = captureSink();
  try {
    await dispatchTool("h_index_categories", {}, { auditSink: sink, callerIp: "203.0.113.7" });
    assert.equal(events.length, 1);
    const e = events[0]!;
    assert.equal(e.evt, "mcp.tool_call");
    assert.equal(e.bucket, "activity");
    assert.equal(e.scope, "operator");
    assert.equal(e.fields?.status, 200);
    assert.equal(e.fields?.tool, "h_index_categories");
    assert.equal(typeof e.fields?.latencyMs, "number");
    // The raw IP must NEVER appear on the event.
    const blob = JSON.stringify(e);
    assert.ok(!blob.includes("203.0.113.7"), "raw IP leaked into the audit event");
    assert.equal(e.fields?.ipHash, hashIp("203.0.113.7"));
    assert.equal(e.fields?.ipPrefix, "203.0.113.0/24");
  } finally {
    restore();
  }
});

test("a self-asserted CAIP-10 owner arg scopes the event to tenant", async () => {
  const restore = stubFetch(200, { ok: true });
  const { sink, events } = captureSink();
  try {
    await dispatchTool(
      "h_index_search",
      { q: "x", owner: "hedera:mainnet:0.0.123" },
      { auditSink: sink },
    );
    const e = events[0]!;
    assert.equal(e.scope, "tenant");
    assert.equal(e.subject, "hedera:mainnet:0.0.123");
  } finally {
    restore();
  }
});

test("a non-402 4xx emits mcp.tool_call_failed (malicious_suspicious)", async () => {
  const restore = stubFetch(404, { error: "not found" });
  const { sink, events } = captureSink();
  try {
    await dispatchTool("h_index_get_listing", { id: "0.0.1/2" }, { auditSink: sink });
    const e = events[0]!;
    assert.equal(e.evt, "mcp.tool_call_failed");
    assert.equal(e.bucket, "malicious_suspicious");
    assert.equal(e.fields?.status, 404);
  } finally {
    restore();
  }
});

test("a 402 challenge emits mcp.tool_call (activity, status 402)", async () => {
  const restore = stubFetch(402, { accepts: [] });
  const { sink, events } = captureSink();
  try {
    await dispatchTool("h_index_register", { endpointUrl: "https://x.example" }, { auditSink: sink });
    const e = events[0]!;
    assert.equal(e.evt, "mcp.tool_call");
    assert.equal(e.bucket, "activity");
    assert.equal(e.fields?.status, 402);
  } finally {
    restore();
  }
});

test("an upstream 5xx emits mcp.tool_call_failed (service_failure) then throws", async () => {
  const restore = stubFetch(500, { error: "boom" });
  const { sink, events } = captureSink();
  try {
    await assert.rejects(() =>
      dispatchTool("h_index_categories", {}, { auditSink: sink }),
    );
    const e = events[0]!;
    assert.equal(e.evt, "mcp.tool_call_failed");
    assert.equal(e.bucket, "service_failure");
    assert.equal(e.fields?.status, 500);
  } finally {
    restore();
  }
});

test("ipHash is one-way and never equals the raw IP; truncateIp is a /24", () => {
  assert.notEqual(hashIp("198.51.100.42"), "198.51.100.42");
  assert.match(hashIp("198.51.100.42"), /^[0-9a-f]{16}$/);
  assert.equal(truncateIp("198.51.100.42"), "198.51.100.0/24");
  assert.equal(truncateIp("::ffff:198.51.100.42"), "198.51.100.0/24");
  assert.equal(truncateIp("2001:db8:1234:5678::1"), "2001:db8:1234::/48");
  assert.equal(truncateIp(""), "unknown");
});
