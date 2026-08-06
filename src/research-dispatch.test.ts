/**
 * Dispatch-path coverage for the research surface with the shared secret PRESENT.
 *
 * The gate (isToolEnabled) is evaluated at call time against RESEARCH_SERVICE_SECRET,
 * and the dispatcher reads the same var at call time to inject the Authorization
 * bearer. Setting the env for this file makes findToolOwner resolve the research
 * tools; the sibling research.test.ts covers the disabled (secret-unset) surface.
 *
 * Locked here: the tool proxies to the exact H-Agent route, presents the bearer
 * from env (never from args, never in the body), forwards the caller body, relays
 * the bundled H-Seal receipt, and forwards the caller's x402 payment_signature as
 * the x-payment header (collect-before-spend).
 */

process.env["RESEARCH_SERVICE_SECRET"] = "s3cr3t-test-value";

import test from "node:test";
import assert from "node:assert/strict";
import { dispatchTool } from "./dispatch.js";
import { findToolOwner } from "./services/index.js";

const realFetch = globalThis.fetch;

function capture(status: number, body: unknown): { restore: () => void; cap: { url: string; init?: RequestInit } } {
  const cap: { url: string; init?: RequestInit } = { url: "" };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    cap.url = String(url);
    cap.init = init;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = realFetch; }, cap };
}

test("the research tools are registered when the secret is set", () => {
  for (const name of ["h_research", "h_research_blogify", "h_research_report", "h_research_calendar"]) {
    assert.ok(findToolOwner(name), `${name} is registered`);
  }
});

test("h_research posts to /research/answer, injects the bearer, relays the receipt", async () => {
  const { restore, cap } = capture(200, {
    answer: "42",
    sources: ["https://example.com"],
    synthesized: true,
    disclaimers: [],
    receipt: { ref: "0.0.999/1", id: "rcpt_1" },
  });
  try {
    const result = (await dispatchTool("h_research", { question: "meaning of life?" })) as {
      answer: string;
      receipt: { ref: string; id: string };
    };
    assert.match(cap.url, /\/research\/answer$/, "targets the answer route");
    assert.equal(cap.init?.method, "POST");
    const headers = cap.init?.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer s3cr3t-test-value", "presents the service bearer");
    const body = JSON.parse(String(cap.init?.body));
    assert.equal(body.question, "meaning of life?");
    assert.ok(!("Authorization" in body), "the secret is never in the body");
    assert.equal(result.answer, "42");
    assert.equal(result.receipt.id, "rcpt_1");
    assert.equal(result.receipt.ref, "0.0.999/1");
  } finally {
    restore();
  }
});

test("each format tool proxies to its own H-Agent route and relays the receipt", async () => {
  const routes: Record<string, RegExp> = {
    h_research_blogify: /\/research\/blogify$/,
    h_research_report: /\/research\/report$/,
    h_research_calendar: /\/research\/calendar$/,
  };
  for (const [tool, re] of Object.entries(routes)) {
    const { restore, cap } = capture(200, { markdown: "# x", events: [], receipt: { ref: "0.0.1/2", id: "r" } });
    try {
      await dispatchTool(tool, { question: "q", answer: "a" });
      assert.match(cap.url, re, `${tool} targets its route`);
      const body = JSON.parse(String(cap.init?.body));
      assert.equal(body.question, "q");
      assert.equal(body.answer, "a");
      const headers = cap.init?.headers as Record<string, string>;
      assert.equal(headers["Authorization"], "Bearer s3cr3t-test-value", `${tool} presents the bearer`);
    } finally {
      restore();
    }
  }
});

test("the caller's x402 payment_signature is forwarded as x-payment (collect-before-spend)", async () => {
  const { restore, cap } = capture(200, { answer: "ok", sources: [], synthesized: true, disclaimers: [], receipt: null });
  try {
    // A clean base64 envelope so the dispatcher's format guard passes.
    await dispatchTool("h_research", { question: "q", payment_signature: "YWJjMTIzKy89" });
    const headers = cap.init?.headers as Record<string, string>;
    assert.equal(headers["x-payment"], "YWJjMTIzKy89", "the x402 envelope rides the x-payment header");
    // payment_signature must NOT be in the forwarded body (it is a transport header).
    const body = JSON.parse(String(cap.init?.body));
    assert.ok(!("payment_signature" in body), "payment_signature is stripped from the body");
  } finally {
    restore();
  }
});

test("a 402 challenge from the research route is relayed whole to the caller", async () => {
  const { restore } = capture(402, { accepts: [{ scheme: "exact", network: "hedera:mainnet" }], x402Version: 1 });
  try {
    const result = (await dispatchTool("h_research", { question: "q" })) as {
      _error: boolean;
      status: number;
      response?: Record<string, unknown>;
    };
    assert.equal(result.status, 402);
    assert.ok(result.response?.["accepts"], "the payment challenge passes through");
  } finally {
    restore();
  }
});
