# h-series-mcp

<!-- H-SERIES-SHARED:START (synced from H-Grant/H-SERIES-CONVENTIONS.md - do not edit here) -->

## H-Series shared conventions

Canonical copy lives in H-Grant (`H-SERIES-CONVENTIONS.md`). Edit it there and run
`scripts/sync-conventions.sh` to propagate the block into every repo's `CLAUDE.md`.
These apply to every repo in the H-Series. Repo-specific instructions live OUTSIDE
the synced block.

### Authorship
- Commit author identity: `XRPL-Utilities <xrpl-utilities@proton.me>` (the
  XR-Utilities org account). Never a personal email.
- The H-Series contact email is `xr-utilities@proton.me` (docs, manifests, public
  contact fields), distinct from the commit author email.
- Commits, PRs, and code contain NO AI or assistant attribution of any kind: no
  "authored by", "co-authored by", or "generated with" referencing Claude, AI, or
  an assistant, and no such markers in code comments. Authorship is the human
  contributor and the org only.

### Style and voice
Applies to ALL output: code, comments, docs, white papers, one-pagers, and website
copy.
- Direct, professional, technical language. No marketing voice.
- No AI-speak. No AI or chatbot language patterns: no flowery or hedging prose, no
  model self-references or assistant disclaimers, no chatty preambles, no preachy
  wrap-up summaries. Lead with the asset or the answer.
- No em dashes. Use commas, parentheses, or semicolons.
- Avoid filler adjectives (robust, seamless, cutting-edge, pivotal, delve, unleash,
  landscape). Prefer solid, functional, reliable.
- Comments explain why, not what.

### Working principle: no guessing
Work and troubleshoot from facts, never assumptions. Ground every change, fix, and
diagnosis in the actual code, data, logs, config, and observed behavior: read the
source, run it, check the output, verify against reality before acting or
concluding. If something cannot be verified, say so plainly instead of guessing.

### Working principle: completeness checks
Before any statement of scope ("all", "none", "every", "there are N", "X exists" /
"X does not exist"), enumerate the authoritative source that defines the set and
verify each member. Never answer scope from memory or the local workspace. For
repos, enumerate the XR-Utilities org via the PAT, not the local `/workspaces`
clones (clones are a partial, possibly stale subset). If a member cannot be
verified, say so explicitly rather than omitting it.

### Security change discipline (where this repo carries SECURITY-LOG.md)
After any change that creates, updates, deletes, or disables/pauses code, do a
focused security review of the diff. If it touches a security-relevant path or
shifts the security posture (trust boundary, secret handling, authorization,
signing, dependencies, logging, or a disabled/relaxed control), append a `pending`
entry to `SECURITY-LOG.md`. The master H-Series security architecture doc (private,
H-Grant `SECURITY-ARCHITECTURE.md`) is the collector. No secrets, keys, or raw
target identifiers in the log.

### Financial change discipline (where this repo carries FINANCIAL-LOG.md)
After any change that affects what a service charges or accepts (a price; a payment
rail, chain, or token; a treasury wallet; a payment surface; a facilitator;
settlement verification; or oracle quoting), append a `pending` entry to
`FINANCIAL-LOG.md`. The canonical treasury source of truth and the audit routine
live in H-Relay (`audit/treasury.json`, `npm run audit:financial`). The master doc
(private, H-Grant `FINANCIAL-ARCHITECTURE.md`) is the collector. No secrets or keys
in the log; public on-chain wallet addresses and token ids are fine.

### Documentation and routines
After any change, update every affected documentation asset: technical (READMEs,
endpoint/API references, `.env.example`), architecture, security (SECURITY-LOG +
the H-Grant master), financial (FINANCIAL-LOG + the H-Grant master, where money is
handled), the white paper, the one-pager / sales sheet, continuity (the session
handoff / next-session notes), and integration (client/SDK and how-to-integrate
docs). Make the doc edit in the SAME commit as the code it describes; a doc left to
update "later" is a doc that drifts (stale version pins, "live" claims for unwired
code, "vendored" claims for a published dependency). Run the routines: a startup
check at session start; smoke tests for the live paths (anything that moves money or
touches a chain, end to end); a Quality + Functionality + Security audit of the diff,
looping until clean; and the closeout gate (typecheck, full tests, the conventions
gate, docs updated, handoff refreshed) before handoff.

A change is not "done" at "pushed". Pushed is not deployed: some surfaces auto-deploy
and some do not, so verify the live service runs the pushed commit before claiming it
shipped. And a security- or money-relevant change is not done until its behavior is
verified (a test or a live probe), not merely typechecked.

### Secrets
Secrets read from environment only. Never committed. In Codespaces use repo-level
Codespace secrets; in production use KMS or platform env injection.

<!-- H-SERIES-SHARED:END -->

Public passthrough MCP server exposing the H-Series APIs (H-Index registry,
H-Seal receipts) as agent tools. Stateless: no database, no wallet, no secrets;
all security is delegated upstream to the backends.

## Security change discipline
This repo is PUBLIC and world-readable. After any change that creates, updates,
deletes, or disables/pauses code, do a focused security review of the diff. Do
NOT keep a security log in this repo. Security-log entries for changes here are
written to the private H-Grant repo as `MCP-SECURITY-LOG.md`; in practice this
repo is worked on from the H-Grant codespace where both are checked out, and the
master security architecture doc (`SECURITY-ARCHITECTURE.md`, private) is the
collector. Never put secrets, keys, or proprietary enforcement detail into this
public repo, in code, comments, logs, or docs.

## Financial change discipline
Same arrangement as the security log: this PUBLIC repo keeps NO financial log of
its own. After any change that affects what a priced tool charges or fronts (a new
or removed priced tool, a changed declared price, or a change to which backend
endpoint a tool maps to), write a `pending` entry to the private H-Grant repo as
`MCP-FINANCIAL-LOG.md`; in practice this repo is worked on from the H-Grant
codespace where both are checked out. The master `FINANCIAL-ARCHITECTURE.md`
(private, in H-Grant) is the collector and folds those entries in. This server
holds no wallet and takes no cut: it forwards the caller's x402 `payment_signature`
to the backend, where settlement lands. Never put secrets or keys in this public repo.

## Git and authorship
- Commit author identity: `XRPL-Utilities <xrpl-utilities@proton.me>` (the
  XR-Utilities GitHub account). Never a personal email.
- H-Series contact / correspondence email is `xr-utilities@proton.me` (docs,
  manifests, public contact fields), distinct from the commit author email.
- Commits, PRs, and code contain no AI or assistant attribution of any kind: no
  "authored by", "co-authored by", or "generated with" referencing Claude, AI,
  or an assistant, and no such markers in code comments. Authorship is the human
  contributor and the org only.

## Working principle: no guessing
Work and troubleshoot from facts, never assumptions. Ground every change, fix,
and diagnosis in the actual code, data, logs, config, and observed behavior:
read the source, run it, check the output, and verify against reality before
acting or concluding. If something can't be verified, say so plainly instead of
guessing. A plausible answer that hasn't been checked is a liability.

## Working principle: completeness checks
Before any statement of scope - "all", "none", "every", "there are N", "X exists",
"X does not exist" - enumerate the authoritative source that defines the set and verify
each member. Never answer scope from memory, recent context, or the local workspace.
- accepted rails / payment methods -> live `GET /config` `accepts`
- chains, treasuries, priced surfaces -> the canonical treasury source of truth
  (`audit/treasury.json` in H-Relay)
- repos -> the XR-Utilities org list via `XR_UTILITIES_PAT`, not the local `/workspaces`
  clones (clones are a partial, possibly stale subset)
- what is configured / which secrets are set -> the actual `env` (a var can be set or
  unset; check, never assume)
- struct fields / variants -> the code or Zod schema
If a member cannot be verified, say so explicitly rather than omitting it. This
operationalizes the "no guessing" principle.
