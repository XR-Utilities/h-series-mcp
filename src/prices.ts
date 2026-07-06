/**
 * Live price cache for the paid-tool descriptions.
 *
 * Each backend publishes its current fee in its own /config, which is the single
 * source of truth for what a paid tool costs. The tool descriptions used to embed
 * a hardcoded dollar string (e.g. "Paid ($0.10 USD)."), which drifted whenever a
 * service changed its price. This module fetches each service's /config once at
 * startup, extracts the live price via a stable field mapping, and caches it for
 * the process lifetime behind a synchronous getter the descriptions interpolate.
 *
 * Fail-safe: a fetch timeout, a non-200, a parse error, or a missing/invalid field
 * leaves the current hardcoded fallback in place, so the server always starts and a
 * description is never broken. The getter is sync (returns cache or fallback); only
 * initPrices is async. Config URLs are resolved from the ServiceDef so the H-Seal /
 * H-Relay backend-URL overrides (private Railway network) are respected rather than
 * hitting the Cloudflare-fronted public host.
 */

import type { ServiceDef } from "./types.js";

/** One key per paid tool. Value is the tool name so call sites read naturally. */
export type PriceKey =
  | "h_index_register"
  | "h_index_renew"
  | "h_seal_anchor"
  | "h_grant_call"
  | "h_relay_send"
  | "h_relay_relay"
  | "h_scope_scan"
  | "h_gate_inspect"
  | "h_pact_create_ring";

interface PriceSpec {
  /** ServiceDef.id, used to resolve the live /config URL (honoring env overrides). */
  serviceId: string;
  /** Dotted path into the /config JSON where the price (whole USD cents) lives. */
  field: string;
  /** The current hardcoded price in USD cents; shown until a live fetch lands. */
  fallbackCents: number;
}

// Field paths verified against each live /config (some nest under `pricing`).
const SPECS: Record<PriceKey, PriceSpec> = {
  h_index_register: { serviceId: "h-index", field: "registrationPriceUsdCents", fallbackCents: 1000 },
  h_index_renew: { serviceId: "h-index", field: "renewalPriceUsdCents", fallbackCents: 500 },
  h_seal_anchor: { serviceId: "h-seal", field: "pricing.anchoringUsdCents", fallbackCents: 5 },
  h_grant_call: { serviceId: "h-grant", field: "priceUsdCents", fallbackCents: 5 },
  h_relay_send: { serviceId: "h-relay", field: "inbox_send_price_usd_cents", fallbackCents: 5 },
  h_relay_relay: { serviceId: "h-relay", field: "relay_fetch_price_usd_cents", fallbackCents: 5 },
  h_scope_scan: { serviceId: "h-scope", field: "pricing.scanPriceUsdCents", fallbackCents: 10 },
  h_gate_inspect: { serviceId: "h-gate", field: "inspectPriceUsdCents", fallbackCents: 10 },
  h_pact_create_ring: { serviceId: "h-pact", field: "pricing.ringCreatePriceUsdCents", fallbackCents: 1000 },
};

const FETCH_TIMEOUT_MS = 4_000;

/** Live prices in USD cents keyed by tool. Empty until initPrices resolves them. */
const liveCents = new Map<PriceKey, number>();

/** Live (or fallback) price for a paid tool, in whole USD cents. */
export function priceCents(key: PriceKey): number {
  return liveCents.get(key) ?? SPECS[key].fallbackCents;
}

/** Format whole USD cents as a plain dollar amount, e.g. 5 -> "0.05", 1000 -> "10.00". */
export function formatUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Live (or fallback) price for a paid tool, formatted for a description (no $ sign). */
export function priceUsd(key: PriceKey): string {
  return formatUsd(priceCents(key));
}

function extract(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

async function fetchConfig(url: string): Promise<Record<string, unknown> | null> {
  const ctl = new AbortController();
  const tId = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(tId);
  }
}

/**
 * Fetch each service's live /config once and cache the price per paid tool. Each
 * config is fetched a single time even when a service prices two tools (H-Index,
 * H-Relay). Best-effort: any failure or a missing/invalid field simply leaves the
 * fallback in place. Never throws, so a caller can await it without guarding.
 */
export async function initPrices(services: ServiceDef[]): Promise<void> {
  const byId = new Map(services.map((s) => [s.id, s]));
  const keysByService = new Map<string, PriceKey[]>();
  for (const [key, spec] of Object.entries(SPECS) as [PriceKey, PriceSpec][]) {
    const arr = keysByService.get(spec.serviceId) ?? [];
    arr.push(key);
    keysByService.set(spec.serviceId, arr);
  }
  await Promise.all(
    [...keysByService.entries()].map(async ([serviceId, keys]) => {
      const svc = byId.get(serviceId);
      if (!svc) return;
      const cfg = await fetchConfig(svc.manifestUrl);
      if (!cfg) return;
      for (const key of keys) {
        const raw = extract(cfg, SPECS[key].field);
        if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
          liveCents.set(key, Math.round(raw));
        }
      }
    }),
  );
}

/** Test seam: clear the live cache so a test can assert the fallback path. */
export function resetPricesForTest(): void {
  liveCents.clear();
}
