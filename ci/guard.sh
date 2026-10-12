#!/usr/bin/env bash
# Fails if anything reintroduces the upstream risks this fork removed:
# R1 writes under ~/.claude, R2 runtime package installs, R5 event forwarder,
# R6 update check, plus telemetry/analytics.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
check() { # $1 = description, $2 = extended regex
  if grep -rnE "$2" src/ --include='*.ts' | grep -v '^src/security.ts:'; then
    echo "GUARD FAILED: $1"; fail=1
  fi
}
check "npm registry / update check (R6)"  'registry\.npmjs\.org'
check "runtime package install (R2)"      "(spawn|exec|execSync|execFile|execFileSync)[^)]*['\"](npm|pnpm|yarn|npx|bun)['\"]|(npm|pnpm|yarn|bun) (install|add)"
check "platform forwarder (R5)"           'platform_url|platform-bridge|platform\.json'
check "writes under ~/.claude (R1)"       "(writeFileSync|appendFileSync|mkdirSync|renameSync|copyFileSync)[^;]*\.claude|['\"]\.claude['\"]"
check "telemetry/analytics"               'posthog|segment\.io|mixpanel|sentry|telemetry'
for f in hooks start.mjs scripts/heal-installed-plugins.mjs; do
  if [ -e "$f" ]; then echo "GUARD FAILED: $f present"; fail=1; fi
done
[ "$fail" -eq 0 ] && echo "guard: ok"
exit $fail
