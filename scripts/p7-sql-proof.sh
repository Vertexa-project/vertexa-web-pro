#!/usr/bin/env bash
# Prova SQL da parte 7 (avatar) num Postgres LOCAL descartável (nunca produção).
# Aplica local_stub + p7_stub + migration P7 (duas vezes: idempotência), roda supabase/tests/p7_avatar.test.sql e apaga tudo.
# Uso: scripts/p7-sql-proof.sh [porta]. MIGRATION=<arquivo> troca a migration (prova de mutação).
set -euo pipefail
PORT="${1:-55437}"
BIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="/var/tmp/dizevolv-ops/pg-p7-$$"
mkdir -p "$D" && chown postgres "$D"
cleanup() { su postgres -s /bin/bash -c "$BIN/pg_ctl -D $D/data -m immediate stop >/dev/null 2>&1 || true"; rm -rf "$D"; }
trap cleanup EXIT
if ss -ltn | grep -q ":$PORT "; then echo "porta $PORT ocupada" >&2; exit 2; fi
su postgres -s /bin/bash -c "$BIN/initdb -D $D/data -A trust -U postgres >/dev/null && $BIN/pg_ctl -D $D/data -o '-p $PORT -k $D -c listen_addresses=127.0.0.1' -l $D/log -w start >/dev/null"
P=(psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${P[@]}" -c "create database p7" >/dev/null
MIG="${MIGRATION:-$ROOT/supabase/migrations/20261123100000_redesign_p7_avatar_tigrezinho.sql}"
for f in "$ROOT/supabase/tests/local_stub.sql" "$ROOT/supabase/tests/p7_stub.sql" "$MIG" "$MIG"; do
  "${P[@]}" -d p7 -f "$f" >/dev/null 2>"$D/err" || { echo "falhou aplicar $f" >&2; cat "$D/err" >&2; exit 1; }
done
OUT="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d p7 -q -At -F '|' -f "$ROOT/supabase/tests/p7_avatar.test.sql" 2>&1)" || true
echo "$OUT" | grep -E 'FALHA|ERROR|^[0-9]+\|[0-9]+$' || true
echo "$OUT" | tail -1 | grep -q '|0$' && echo "PROVA SQL OK ($(echo "$OUT" | tail -1 | cut -d'|' -f1) asserções; migration aplicada 2x)" || { echo "PROVA SQL COM FALHAS" >&2; exit 1; }
