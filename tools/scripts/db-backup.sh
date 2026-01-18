#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <database-url> <output-file>" >&2
  exit 1
fi

db_url="$1"
output_file="$2"

pg_dump "$db_url" > "$output_file"
echo "backup written to $output_file"
