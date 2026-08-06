import type { ServiceDef, ToolDef } from "../types.js";
import { priceUsd } from "../prices.js";

/**
 * H-Agent research surface: the metered MACHINE research product, the estate's
 * revenue surface exposed to agents. The passthrough collects the x402
 * micropayment (inline_x402, like every other paid tool) and THEN presents the
 * shared RESEARCH_SERVICE_SECRET as an Authorization bearer to H-Agent's
 * /research/* routes, which do the retrieval + synthesis and bundle a FREE
 * H-Seal receipt. Collect-before-spend: the pay leg runs first, the backend work
 * second.
 *
 * Fail-closed: the tools below are registered ONLY when RESEARCH_SERVICE_SECRET
 * is set in the passthrough environment (see RESEARCH_TOOLS). With it unset the
 * research surface is not advertised or callable at all, matching the backend,
 * which itself returns 503 research_disabled when its own secret/key are unset.
 * The secret is env-only, presented as a header via secretHeaderEnv, and never
 * appears in an inputSchema, a body, a query, or a log line.
 *
 * Backend base URL override (H_AGENT_BACKEND_URL) mirrors H-Seal/H-Relay so the
 * passthrough can reach H-Agent over Railway's private network when co-deployed.
 */
const H_AGENT_BASE = process.env["H_AGENT_BACKEND_URL"] || "https://h-agent.xr-utilities.ai";

// The env var holding the shared service secret gating the H-Agent research routes.
// The research tools are always PART of the static surface; whether they are
// advertised/callable is decided at RUNTIME by isToolEnabled (services/index.ts),
// which checks this var is set. That keeps the gate fail-closed while letting an
// operator set/rotate the secret without a rebuild.
const RESEARCH_SECRET_ENV = "RESEARCH_SERVICE_SECRET";

// Present the shared secret as an Authorization bearer. Env-only, never in args.
const RESEARCH_AUTH: NonNullable<ToolDef["secretHeaderEnv"]> = {
  Authorization: { env: RESEARCH_SECRET_ENV, prefix: "Bearer " },
};

// question + answer are shared by the format tools (blogify/report/calendar),
// which turn a prior answer into a publish-ready artifact.
const questionProp = {
  type: "string" as const,
  description: "The research question to answer (natural language).",
};
const answerProp = {
  type: "string" as const,
  description: "The prior research answer to format. Get one from h_research first.",
};
const asOfProp = {
  type: "number" as const,
  description: "Optional Unix timestamp (seconds) to anchor the 'as of' date of the synthesis.",
};

const RESEARCH_TOOLS: ToolDef[] = [
  {
    name: "h_research",
    get description() {
      return (
        `Paid ($${priceUsd("h_research")} USD). Answer a research question: live web retrieval plus a ` +
        "synthesized, source-cited answer, with consumer-safety disclaimers attached where a domain " +
        "(medical, financial, legal, tax, veterinary) calls for one. Returns { answer, sources, " +
        "synthesized, disclaimers, receipt }. A bundled H-Seal proof-of-execution receipt is included " +
        "FREE. Pass question (required), an optional constraints hint, an optional pre-fetched content " +
        "to synthesize over instead of retrieving, an optional asOf timestamp, and an x402 " +
        "payment_signature."
      );
    },
    inputSchema: {
      type: "object",
      properties: {
        question: questionProp,
        content: {
          type: "string",
          description:
            "Optional pre-fetched content to synthesize over. When present, retrieval is skipped and " +
            "the answer is grounded in this text (parity with the console's own governed retrieval).",
        },
        constraints: {
          type: "string",
          description: "Optional constraints or focus for the synthesis (natural language).",
        },
        asOf: asOfProp,
        payment_signature: { type: "string", description: "x402 payment header (base64)." },
      },
      required: ["question"],
      additionalProperties: false,
    },
    method: "POST",
    path: "/research/answer",
    authMode: "inline_x402",
    bodyFromArgs: true,
    priceUsd: 0.05,
    secretHeaderEnv: RESEARCH_AUTH,
  },
  {
    name: "h_research_blogify",
    get description() {
      return (
        `Paid ($${priceUsd("h_research_blogify")} USD). Turn a research answer into a publish-ready blog post ` +
        "(Markdown). Returns { markdown, receipt } with a bundled H-Seal receipt FREE. Run h_research " +
        "first, then pass its question and answer here (both required), an optional asOf timestamp, and " +
        "an x402 payment_signature."
      );
    },
    inputSchema: {
      type: "object",
      properties: {
        question: questionProp,
        answer: answerProp,
        asOf: asOfProp,
        payment_signature: { type: "string", description: "x402 payment header (base64)." },
      },
      required: ["question", "answer"],
      additionalProperties: false,
    },
    method: "POST",
    path: "/research/blogify",
    authMode: "inline_x402",
    bodyFromArgs: true,
    priceUsd: 0.5,
    secretHeaderEnv: RESEARCH_AUTH,
  },
  {
    name: "h_research_report",
    get description() {
      return (
        `Paid ($${priceUsd("h_research_report")} USD). Turn a research answer into a deep, decision-ready report ` +
        "(Markdown). Returns { markdown, receipt } with a bundled H-Seal receipt FREE. Run h_research " +
        "first, then pass its question and answer here (both required), an optional asOf timestamp, and " +
        "an x402 payment_signature."
      );
    },
    inputSchema: {
      type: "object",
      properties: {
        question: questionProp,
        answer: answerProp,
        asOf: asOfProp,
        payment_signature: { type: "string", description: "x402 payment header (base64)." },
      },
      required: ["question", "answer"],
      additionalProperties: false,
    },
    method: "POST",
    path: "/research/report",
    authMode: "inline_x402",
    bodyFromArgs: true,
    priceUsd: 2.0,
    secretHeaderEnv: RESEARCH_AUTH,
  },
  {
    name: "h_research_calendar",
    get description() {
      return (
        `Paid ($${priceUsd("h_research_calendar")} USD). Extract datable calendar events from a research answer. ` +
        "Returns { events } (title, start, end, location where present). Run h_research first, then " +
        "pass its question and answer here (both required), an optional asOf timestamp, and an x402 " +
        "payment_signature."
      );
    },
    inputSchema: {
      type: "object",
      properties: {
        question: questionProp,
        answer: answerProp,
        asOf: asOfProp,
        payment_signature: { type: "string", description: "x402 payment header (base64)." },
      },
      required: ["question", "answer"],
      additionalProperties: false,
    },
    method: "POST",
    path: "/research/calendar",
    authMode: "inline_x402",
    bodyFromArgs: true,
    priceUsd: 0.05,
    secretHeaderEnv: RESEARCH_AUTH,
  },
];

// The H-Agent service def. The research tools are always part of the static
// surface; the fail-closed gate (isToolEnabled, keyed on RESEARCH_SERVICE_SECRET)
// is applied at list/dispatch time, so an unset secret means none are advertised
// or callable (matching the backend, which returns 503 research_disabled).
export const hAgent: ServiceDef = {
  id: "h-agent",
  label: "H-Agent",
  baseUrl: H_AGENT_BASE,
  manifestUrl: `${H_AGENT_BASE}/config`,
  // H-Agent's /config does not advertise a schema_version yet; leave empty so the
  // startup validator warns (never errors) on drift, like H-Gate/H-Scope.
  knownSchemaVersions: [],
  tools: RESEARCH_TOOLS,
};

// Test seam: the full research tool list, so a test can assert their contract
// (prices, routes, auth) without depending on the runtime env gate.
export const RESEARCH_TOOLS_FOR_TEST: ToolDef[] = RESEARCH_TOOLS;
