// Drift reminder for this repo's own H-Index listing (the H-Series MCP passthrough at
// mcp.xr-utilities.ai/mcp). A change to the tool surface this server exposes must be followed by a
// free owner-update of the H-Index listing, or the listing reads as `drift` in discovery. This reads
// H-Index's authoritative liveness verdict and warns if the live surface no longer matches the
// attested manifest. Read-only, zero-dep.
//
// Fix a drift from the H-Index repo:
//   REGISTRAR_PRIVATE_KEY=... npx tsx scripts/register-listing.ts h-series   (free owner-update)
//
// Note: this reads the DEPLOYED surface, so a change made this session shows up only after it
// deploys. The daily mcp-listing-drift Action in the H-Index repo is the hard catch.

const HINDEX = (process.env.HINDEX || "https://h-index.xr-utilities.ai").replace(/\/+$/, "");
const URL_SELF = "https://mcp.xr-utilities.ai/mcp";
const NAME = "H-Series MCP";
const UA = "h-series-mcp-drift-check/1"; // the API 403s the stock node UA behind its bot challenge

async function getJson(path) {
  const res = await fetch(`${HINDEX}${path}`, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function findSelf() {
  const seen = new Map();
  const scan = (r) => {
    for (const x of r || []) if (x?.endpointUrl && !seen.has(x.endpointUrl)) seen.set(x.endpointUrl, x);
  };
  try {
    scan((await getJson(`/endpoints?q=${encodeURIComponent(NAME)}&limit=25`)).results);
  } catch {
    /* fall through */
  }
  if (seen.has(URL_SELF)) return seen.get(URL_SELF);
  let cursor = "";
  for (let page = 0; page < 12; page++) {
    const d = await getJson(`/endpoints?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    scan(d.results);
    if (seen.has(URL_SELF)) return seen.get(URL_SELF);
    cursor = d.nextCursor || "";
    if (!cursor) break;
  }
  return seen.get(URL_SELF) || null;
}

async function main() {
  let rec;
  try {
    rec = await findSelf();
  } catch (err) {
    console.error(`could not read the H-Index listing: ${err.message}`);
    return 0; // reachability issue, not a drift finding; do not block closeout on it
  }
  if (!rec) {
    console.log(`? ${NAME} (${URL_SELF}): not found in discovery`);
    return 0;
  }
  const flag = (rec.trust?.flags || []).find((f) => f?.type === "drift");
  const verdict = rec.liveness?.verdict ?? "unprobed";
  if (flag) {
    console.error(
      `DRIFT ${NAME} (listing ${rec.id}, verdict ${verdict}): the live tool surface no longer matches ` +
        `the attested manifest. Re-register from the H-Index repo (free owner-update):\n` +
        `  REGISTRAR_PRIVATE_KEY=... npx tsx scripts/register-listing.ts h-series`,
    );
    return 1;
  }
  console.log(`ok  ${NAME} (listing ${rec.id}) matches its attested manifest (verdict ${verdict}).`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`check-listing-drift failed: ${err.message}`);
    process.exit(2);
  });
