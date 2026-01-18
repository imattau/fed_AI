#!/usr/bin/env bash
set -euo pipefail

base_ref="${BASE_REF:-}"
if [[ -z "$base_ref" ]]; then
  echo "BASE_REF not set; skipping version bump checks."
  exit 0
fi

base_commit="$(git merge-base "$base_ref" HEAD)"
changed_files="$(git diff --name-only "$base_commit"...HEAD)"

require_bump() {
  local path_prefix="$1"
  local package_json="$2"
  if echo "$changed_files" | grep -q "^${path_prefix}"; then
    if ! echo "$changed_files" | grep -q "^${package_json}$"; then
      echo "Version bump required: ${package_json} must change when ${path_prefix} changes."
      exit 1
    fi
  fi
}

require_bump "packages/protocol/src/" "packages/protocol/package.json"
require_bump "packages/sdk-js/src/" "packages/sdk-js/package.json"

echo "Version bump checks passed."
