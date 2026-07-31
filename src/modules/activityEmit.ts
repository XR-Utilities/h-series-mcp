// Fire-and-forget POST of one per-tool-call trace row to the H-Index agent-activity hub
// (option (c)): the queryable "what did this agent call" record, kept OFF the SIEM audit topic
// (anchoring every routine tool-call would firehose the security detection plane). Env-gated:
// HINDEX_ACTIVITY_URL (the hub's POST /activity endpoint) + ACTIVITY_INGEST_SECRET (the bearer).
// Either unset -> no-op. NEVER throws into the tool-call path. Public-safe scalars only; the IP
// arrives already hashed (the caller passes ipHash/ipPrefix, never a raw IP).

export interface ActivityRow {
  subject?: string;
  product: string;
  kind: "tool_call" | "external_call";
  tool?: string;
  route?: string;
  action?: string;
  status?: string;
  latencyMs?: number;
  ipHash?: string;
  ipPrefix?: string;
  counterparty?: string;
}

const ACTIVITY_URL = process.env["HINDEX_ACTIVITY_URL"] ?? "";
const ACTIVITY_SECRET = process.env["ACTIVITY_INGEST_SECRET"] ?? "";

export function activityConfigured(): boolean {
  return ACTIVITY_URL.length > 0 && ACTIVITY_SECRET.length > 0;
}

export function postActivity(row: ActivityRow): void {
  if (!activityConfigured()) return;
  void fetch(ACTIVITY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ACTIVITY_SECRET}` },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // A trace-post failure must never affect the tool call. Swallow.
  });
}
