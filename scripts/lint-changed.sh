#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "lint-changed.sh is intended for GitHub Actions." >&2
  exit 64
fi

if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
  base_ref="${GITHUB_BASE_REF:-main}"
  git fetch --no-tags --depth=1 origin "${base_ref}"
  base="$(git merge-base HEAD "origin/${base_ref}")"
else
  before="${GITHUB_EVENT_BEFORE:-}"
  if [[ -n "${before}" && ! "${before}" =~ ^0+$ ]] && git cat-file -e "${before}^{commit}" 2>/dev/null; then
    base="${before}"
  elif git rev-parse HEAD^ >/dev/null 2>&1; then
    base="HEAD^"
  else
    npm run lint
    exit 0
  fi
fi

mapfile -d '' changed_files < <(
  git diff --name-only --diff-filter=ACMRT -z "${base}" HEAD -- \
    '*.js' '*.jsx' '*.mjs' '*.cjs' '*.ts' '*.tsx'
)

if [[ "${#changed_files[@]}" -eq 0 ]]; then
  echo "No changed JavaScript or TypeScript files to lint."
  exit 0
fi

printf 'Linting %d changed source file(s):\n' "${#changed_files[@]}"
printf ' - %s\n' "${changed_files[@]}"
./node_modules/.bin/eslint "${changed_files[@]}"
