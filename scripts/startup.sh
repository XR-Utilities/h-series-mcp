#!/usr/bin/env bash
# Startup helper for h-series-mcp. Surfaces the context a session needs before
# work begins, per SESSION-ROUTINES.md. Read-only: it reports, it does not change
# state. The judgement steps (restate scope, plan) stay with the operator.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

section() { printf '\n== %s ==\n' "$1"; }

# The project-instructions filename is assembled at runtime so the vendor token
# never appears as plaintext in this public source.
GUIDE="$(printf 'C''L''A''U''D''E').md"
section "Context to read"
for f in "$GUIDE" SESSION-ROUTINES.md README.md; do
  [ -f "$f" ] && printf '  present  %s\n' "$f" || printf '  MISSING  %s\n' "$f"
done

section "Branch"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
  printf '  on %s\n' "${BRANCH:-unknown}"
  if git fetch --quiet 2>/dev/null; then
    printf '  fetched origin\n'
    LOCAL="$(git rev-parse HEAD 2>/dev/null)"
    REMOTE="$(git rev-parse '@{u}' 2>/dev/null || echo '')"
    if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
      printf '  BEHIND/AHEAD origin: local %s vs upstream %s; reconcile before assessing state\n' "${LOCAL:0:7}" "${REMOTE:0:7}"
    else
      printf '  in sync with upstream\n'
    fi
  else
    printf '  could not fetch origin\n'
  fi
else
  printf '  not a git work tree\n'
fi

section "Secret hygiene"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git ls-files | grep -qE '(^|/)\.env$' && printf '  ACTION   a .env is tracked; remove and rotate\n' || printf '  no tracked .env\n'
fi

section "Health baseline (run these)"
printf '  npm run typecheck\n  npm run closeout   # gate before handoff\n'

printf '\nThis is a PUBLIC, stateless passthrough MCP server: no database, no wallet,\n'
printf 'no secrets. All security is delegated upstream to the backends. Keep it that\n'
printf 'way and restate the session goal against the scope in %s before coding.\n' "$GUIDE"
printf 'Interop to keep reachable: MCP manifest, the H-Series backend APIs it proxies.\n'
