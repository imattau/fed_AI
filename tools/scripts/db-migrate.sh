#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <database-url> <sql-file> [sql-file...]" >&2
  exit 1
fi

db_url="$1"
shift

for sql_file in "$@"; do
  if [[ ! -f "$sql_file" ]]; then
    echo "missing sql file: $sql_file" >&2
    exit 1
  fi
  psql "$db_url" -v ON_ERROR_STOP=1 -f "$sql_file"
done
