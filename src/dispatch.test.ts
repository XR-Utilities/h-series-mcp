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

test("h_index_search forwards the trust-tier filters as query params", async () => {
  const f = captureUrl(200, { mode: "semantic", results: [] });
  try {
    await dispatchTool("h_index_search", {
      q: "registry",
      trust: "observed_any",
      excludeFlags: "drift,vuln",
      paid: "open",
      tags: "data",
    });
    const url = new URL(f.get());
    assert.equal(url.pathname, "/endpoints");
    assert.equal(url.searchParams.get("trust"), "observed_any");
    assert.equal(url.searchParams.get("excludeFlags"), "drift,vuln");
    assert.equal(url.searchParams.get("paid"), "open");
    assert.equal(url.searchParams.get("tags"), "data");
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
