# h-series-mcp

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
