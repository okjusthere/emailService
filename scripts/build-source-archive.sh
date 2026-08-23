#!/usr/bin/env bash
set -euo pipefail

mode="${1:-build}"
output="${2:-artifacts/homix-marketing-source.tar.gz}"

forbidden_pattern='(^|/)(\.env($|\.)|node_modules/|dist/|coverage/|playwright-report/|test-results/|reports/|\.git/|\.DS_Store$|[^/]+\.(pem|key|p12|pfx)$|id_rsa($|\.))'
violations="$(git ls-files | grep -E "$forbidden_pattern" | grep -v -E '(^|/)\.env\.example$' || true)"
if [[ -n "$violations" ]]; then
  echo "Refusing source archive; forbidden tracked paths:" >&2
  echo "$violations" >&2
  exit 1
fi

if [[ "$mode" == "--check" ]]; then
  echo "Tracked source archive policy passed."
  exit 0
fi

mkdir -p "$(dirname "$output")"
git archive --format=tar.gz --prefix=homix-marketing/ --output="$output" HEAD
echo "Created $output from tracked files only."
