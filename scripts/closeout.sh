#!/usr/bin/env bash
# Closeout gate for h-series-mcp. Runs the mechanical quality/security checks
# that a grep can catch, so they gate at commit time instead of being found by a
# later audit. Judgement steps (full code review, interop, doc freshness) stay
# with the operator and are listed at the end as a manual checklist. Exit
# non-zero if any hard check fails.
#
# Hard fails block handoff: typecheck, authorship markers, em dashes, committed
# secrets, tracked .env. Warnings surface things to look at but do not block.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILS=0
WARNS=0

pass() { printf '  PASS  %s\n' "$1"; }
warn() { printf '  WARN  %s\n' "$1"; WARNS=$((WARNS + 1)); }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
skip() { printf '  SKIP  %s\n' "$1"; }
section() { printf '\n== %s ==\n' "$1"; }

# Tracked files only, so untracked scratch and node_modules never trip the scan.
tracked() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files
  else
    find . -type f -not -path './.git/*' -not -path './node_modules/*'
  fi
}

# Exclude this script from the content scans: it necessarily contains the very
# patterns it searches for, and would otherwise flag itself.
SELF="scripts/closeout.sh"
scan_files() { tracked | grep -vE '^scripts/(closeout|check-conventions)\.sh

# The project-instructions filename, assembled at runtime so the vendor token
# never appears as plaintext in this public source.
GUIDE="$(printf 'C''L''A''U''D''E').md"

section "Toolchain"
# Run a script only if package.json actually defines it, so adding a script
# elsewhere does not break this gate and a missing one does not false-fail.
if [ -f package.json ]; then
  if grep -q '"typecheck"' package.json; then
    npm run --silent typecheck && pass "typecheck" || fail "typecheck failed"
  else
    skip "no typecheck script"
  fi
  if grep -q '"test"' package.json; then
    npm run --silent test && pass "unit tests" || fail "unit tests failed"
  else
    skip "no test script"
  fi
else
  skip "no package.json"
fi

section "Authorship hygiene (hard fail)"
# Precise attribution footers, not policy mentions. Commit messages are not
# scanned (only tracked files); these strings are never legitimate in content.
# This repo is public: the vendor and tool-name words must NOT appear as
# plaintext in this source, so the markers are assembled at runtime from
# fragments (same way the secret shapes below are split). Generic markers stay
# literal.
V1="$(printf 'C''l''a''u''d''e')"
V2="$(printf 'a''n''t''h''r''o''p''i''c')"
AUTHORSHIP="Co-[Aa]uthored-[Bb]y:|🤖 Generated|noreply@${V2}\.com|Authored-By: ${V1}|[Gg]enerated with \[?${V1}"
HITS="$(scan_files | xargs -r grep -InE "$AUTHORSHIP" 2>/dev/null || true)"
if [ -n "$HITS" ]; then
  fail "authorship markers found:"
  printf '%s\n' "$HITS" | sed 's/^/        /'
else
  pass "no co-authorship or vendor attribution markers"
fi

section "Em dash (hard fail)"
DASHES="$(scan_files | xargs -r grep -InP '\x{2014}' 2>/dev/null || true)"
if [ -n "$DASHES" ]; then
  fail "em dash (U+2014) found; replace with comma, colon, or sentence break:"
  printf '%s\n' "$DASHES" | sed 's/^/        /'
else
  pass "no em dashes"
fi

section "Committed secrets (hard fail)"
# High-signal credential shapes. Patterns are assembled so this script is not
# itself a disclosure. The last is the Ed25519/ECDSA DER PRIVATE-key prefix,
# distinct from the public-key SPKI prefix.
SECRETS="-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|302e020100300506032b657004"
HITS="$(scan_files | xargs -r grep -InE "$SECRETS" 2>/dev/null || true)"
if [ -n "$HITS" ]; then
  fail "possible committed secret:"
  printf '%s\n' "$HITS" | sed 's/^/        /'
else
  pass "no obvious committed secrets"
fi
if tracked | grep -qE '(^|/)\.env$'; then
  fail "a .env file is tracked; remove it and rotate anything it held"
else
  pass "no tracked .env"
fi

section "Filler (warn)"
# Clear filler/marketing lingo only, to keep noise low. Skip the policy doc that
# may name some of these words on purpose.
FILLER='\b(leverage|utilize|streamline|cutting-edge|revolutionary|game-changing|seamless|delve|tapestry|multifaceted|pivotal|groundbreaking|unleash)\b'
HITS="$(scan_files | grep -E '\.(md|txt|json|ts|js)$' \
        | grep -v -F "$GUIDE" \
        | xargs -r grep -InE "$FILLER" 2>/dev/null || true)"
if [ -n "$HITS" ]; then
  warn "filler words to review:"
  printf '%s\n' "$HITS" | sed 's/^/        /'
else
  pass "no filler words"
fi

section "Working tree"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
  pass "on branch ${BRANCH:-unknown}"
  if [ -n "$(git status --porcelain)" ]; then
    warn "working tree has uncommitted or untracked changes:"
    git status --porcelain | sed 's/^/        /'
  else
    pass "working tree clean"
  fi
fi

section "Manual checklist (not automatable; confirm by hand)"
cat <<'EOF'
  [ ] Review the diff as an external auditor for bugs and security before handoff
  [ ] Server stays stateless: no database, no wallet, no secrets added
  [ ] Inbound tool arguments validated before dispatch to a backend
  [ ] No security delegated here that belongs upstream; trust boundary unchanged
  [ ] Nothing proprietary or enforcement-detail leaked to this public repo
  [ ] Interop: MCP manifest and the H-Series backend APIs it proxies still resolve
  [ ] Docs current: README, project-instructions file, tool descriptions
  [ ] Security-log entry written to the private H-Grant repo if posture shifted
  [ ] Workspace clean: no leftover scratch files
EOF

section "Result"
printf 'fails=%d warns=%d\n' "$FAILS" "$WARNS"
if [ "$FAILS" -gt 0 ]; then
  echo "CLOSEOUT BLOCKED: resolve the failures above before handoff."
  exit 1
fi
echo "Mechanical gate passed. Complete the manual checklist before handoff."
exit 0
; }

# The project-instructions filename, assembled at runtime so the vendor token
# never appears as plaintext in this public source.
GUIDE="$(printf 'C''L''A''U''D''E').md"

section "Toolchain"
# Run a script only if package.json actually defines it, so adding a script
# elsewhere does not break this gate and a missing one does not false-fail.
if [ -f package.json ]; then
  if grep -q '"typecheck"' package.json; then
    npm run --silent typecheck && pass "typecheck" || fail "typecheck failed"
  else
    skip "no typecheck script"
  fi
  if grep -q '"test"' package.json; then
    npm run --silent test && pass "unit tests" || fail "unit tests failed"
  else
    skip "no test script"
  fi
else
  skip "no package.json"
fi

section "Authorship hygiene (hard fail)"
# Precise attribution footers, not policy mentions. Commit messages are not
# scanned (only tracked files); these strings are never legitimate in content.
# This repo is public: the vendor and tool-name words must NOT appear as
# plaintext in this source, so the markers are assembled at runtime from
# fragments (same way the secret shapes below are split). Generic markers stay
# literal.
V1="$(printf 'C''l''a''u''d''e')"
V2="$(printf 'a''n''t''h''r''o''p''i''c')"
AUTHORSHIP="Co-[Aa]uthored-[Bb]y:|🤖 Generated|noreply@${V2}\.com|Authored-By: ${V1}|[Gg]enerated with \[?${V1}"
HITS="$(scan_files | xargs -r grep -InE "$AUTHORSHIP" 2>/dev/null || true)"
if [ -n "$HITS" ]; then
  fail "authorship markers found:"
  printf '%s\n' "$HITS" | sed 's/^/        /'
else
  pass "no co-authorship or vendor attribution markers"
fi

section "Em dash (hard fail)"
DASHES="$(scan_files | xargs -r grep -InP '\x{2014}' 2>/dev/null || true)"
if [ -n "$DASHES" ]; then
  fail "em dash (U+2014) found; replace with comma, colon, or sentence break:"
  printf '%s\n' "$DASHES" | sed 's/^/        /'
else
  pass "no em dashes"
fi

section "Committed secrets (hard fail)"
# High-signal credential shapes. Patterns are assembled so this script is not
# itself a disclosure. The last is the Ed25519/ECDSA DER PRIVATE-key prefix,
# distinct from the public-key SPKI prefix.
SECRETS="-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|302e020100300506032b657004"
HITS="$(scan_files | xargs -r grep -InE "$SECRETS" 2>/dev/null || true)"
if [ -n "$HITS" ]; then
  fail "possible committed secret:"
  printf '%s\n' "$HITS" | sed 's/^/        /'
else
  pass "no obvious committed secrets"
fi
if tracked | grep -qE '(^|/)\.env$'; then
  fail "a .env file is tracked; remove it and rotate anything it held"
else
  pass "no tracked .env"
fi

section "Filler (warn)"
# Clear filler/marketing lingo only, to keep noise low. Skip the policy doc that
# may name some of these words on purpose.
FILLER='\b(leverage|utilize|streamline|cutting-edge|revolutionary|game-changing|seamless|delve|tapestry|multifaceted|pivotal|groundbreaking|unleash)\b'
HITS="$(scan_files | grep -E '\.(md|txt|json|ts|js)$' \
        | grep -v -F "$GUIDE" \
        | xargs -r grep -InE "$FILLER" 2>/dev/null || true)"
if [ -n "$HITS" ]; then
  warn "filler words to review:"
  printf '%s\n' "$HITS" | sed 's/^/        /'
else
  pass "no filler words"
fi

section "Working tree"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
  pass "on branch ${BRANCH:-unknown}"
  if [ -n "$(git status --porcelain)" ]; then
    warn "working tree has uncommitted or untracked changes:"
    git status --porcelain | sed 's/^/        /'
  else
    pass "working tree clean"
  fi
fi

section "Manual checklist (not automatable; confirm by hand)"
cat <<'EOF'
  [ ] Review the diff as an external auditor for bugs and security before handoff
  [ ] Server stays stateless: no database, no wallet, no secrets added
  [ ] Inbound tool arguments validated before dispatch to a backend
  [ ] No security delegated here that belongs upstream; trust boundary unchanged
  [ ] Nothing proprietary or enforcement-detail leaked to this public repo
  [ ] Interop: MCP manifest and the H-Series backend APIs it proxies still resolve
  [ ] Docs current: README, project-instructions file, tool descriptions
  [ ] Security-log entry written to the private H-Grant repo if posture shifted
  [ ] Workspace clean: no leftover scratch files
EOF

section "Result"
printf 'fails=%d warns=%d\n' "$FAILS" "$WARNS"
if [ "$FAILS" -gt 0 ]; then
  echo "CLOSEOUT BLOCKED: resolve the failures above before handoff."
  exit 1
fi
echo "Mechanical gate passed. Complete the manual checklist before handoff."
exit 0
