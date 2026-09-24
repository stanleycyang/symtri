#!/usr/bin/env bash
set -euo pipefail

pg_bin="${SYMTRI_PG_BIN:-$(pg_config --bindir)}"
cluster="$(mktemp -d "${TMPDIR:-/tmp}/symtri-scale-pg.XXXXXX")"
port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
started=0

cleanup() {
  if [[ "$started" == 1 ]]; then "$pg_bin/pg_ctl" -D "$cluster" -m fast stop >/dev/null 2>&1 || true; fi
  rm -rf "$cluster"
}
trap cleanup EXIT

"$pg_bin/initdb" -D "$cluster" -A trust -U "$(id -un)" >/dev/null
"$pg_bin/pg_ctl" -D "$cluster" -o "-p $port -h 127.0.0.1" -l "$cluster/server.log" start >/dev/null
started=1

SYMTRI_TEST_DATABASE_URL="postgres://$(id -un)@127.0.0.1:$port/postgres" npx tsx scripts/check-growth-scale.ts
