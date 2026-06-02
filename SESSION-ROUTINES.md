# Session routines

The discipline that keeps quality and security from being an afterthought. Two
runnable helpers plus the judgement that stays with the operator. The guiding
rule: catch bugs and security issues BEFORE they are committed, not in a later
audit. Mirrors the H-Series sibling repos.

## At session start: `npm run startup`

Read-only orientation. Reports the context docs to read, fetches origin and
flags if the local checkout is behind upstream (the `/workspaces` clones run days
stale, so always reconcile first), and checks secret hygiene. Then restate the
session goal against the scope in the project instructions file before writing
code. This repo is a
PUBLIC, stateless passthrough MCP server: no database, no wallet, no secrets, all
security delegated upstream. Keep it that way.

## During work

- Validate inbound tool arguments before dispatching to a backend.
- The server stays stateless: no persistence, no wallet, no secrets in this repo.
- Nothing proprietary: this repo is public and world-readable. No internal
  architecture or enforcement detail in code, comments, logs, or docs. Only
  public product names.
- After a change that shifts security posture (trust boundary, dependencies,
  logging, a relaxed control), write the security-log entry to the private
  H-Grant repo. Do not keep a security log in this public repo.

## Before handoff: `npm run closeout`

The gate. Runs `typecheck` (and `test` if defined) and HARD-FAILS on:
co-authorship or vendor attribution markers, em dashes (U+2014), committed-secret
shapes, or a tracked `.env`. WARNS on filler words and surfaces an uncommitted
working tree. Any hard fail exits non-zero and blocks handoff.

Before handoff, also review the diff yourself for bugs and security issues as an
external auditor would. Then complete the manual judgement checklist the gate
prints (statelessness, argument validation, trust boundary, public-repo privacy,
interop, docs, workspace hygiene).

## Authorship and content

Commits, PRs, and code carry no co-authorship or vendor attribution. No em
dashes, no filler adjectives. Public contact email is `xr-utilities@proton.me`.
Commit author is `XRPL-Utilities <xrpl-utilities@proton.me>`.
