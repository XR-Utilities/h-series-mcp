#!/usr/bin/env bash
# H-Series conventions gate. Fails when ADDED lines in the diff introduce an em
# dash or AI/assistant attribution. Diff-scoped on purpose: it enforces going
# forward and never fails on pre-existing content. Runs in CI and locally.
set -uo pipefail

base="${1:-}"
if [ -z "$base" ]; then
  if [ -n "${GITHUB_BASE_REF:-}" ]; then base="origin/${GITHUB_BASE_REF}"
  elif [ -n "${GITHUB_EVENT_BEFORE:-}" ] && git rev-parse --verify -q "${GITHUB_EVENT_BEFORE}" >/dev/null 2>&1 \
       && [ "${GITHUB_EVENT_BEFORE}" != "0000000000000000000000000000000000000000" ]; then base="${GITHUB_EVENT_BEFORE}"
  elif git rev-parse --verify -q HEAD~1 >/dev/null 2>&1; then base="HEAD~1"
  fi
fi

# Exclude the gate machinery itself: these files legitimately contain the
# detection patterns (the regex, the prose about attribution) and must not be
# flagged by their own rule.
EX=( ":(exclude)scripts/check-conventions.sh" ":(exclude)scripts/sync-conventions.sh" ":(exclude)H-SERIES-CONVENTIONS.md" )
if [ -n "$base" ]; then
  added="$(git diff "$base"...HEAD -- . "${EX[@]}" 2>/dev/null | grep '^+' | grep -v '^+++' || true)"
else
  added="$(git diff --cached -- . "${EX[@]}" 2>/dev/null | grep '^+' | grep -v '^+++' || true)"
fi

fail=0
if printf '%s' "$added" | grep -q '—'; then
  echo "::error::conventions gate: an em dash was introduced. Use commas, parentheses, or semicolons."
  printf '%s\n' "$added" | grep '—' | head -5
  fail=1
fi
if printf '%s' "$added" | grep -qiE 'co-authored-by:[[:space:]]*(claude|anthropic)|generated with[[:space:]]+(claude|ai)|authored[[:space:]]+by[[:space:]]+(claude|ai|an assistant)|🤖'; then
  echo "::error::conventions gate: AI/assistant attribution was introduced. Authorship is the human contributor and the org only."
  fail=1
fi
if printf '%s' "$added" | grep -qiE "as an ai( language model| assistant)?\b|as a language model\b|i'm (just )?an ai\b|i am (just )?an ai\b"; then
  echo "::error::conventions gate: AI-speak / assistant disclaimer was introduced. Write in a direct, human, professional voice."
  fail=1
fi
[ "$fail" = "0" ] && echo "conventions gate: clean"
exit "$fail"
