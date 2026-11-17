#!/usr/bin/env bash
# Prova SQL da A8 (rascunho de dieta e treino pela Vertexa IA) num Postgres LOCAL descartável (nunca produção).
# Aplica stub local (fin_local_stub + p6_stub + a8_stub) + migration A8, roda supabase/tests/a8_rascunho_ia.test.sql e apaga tudo.
# Uso: scripts/a8-sql-proof.sh [porta]. MIGRATION=<arquivo> troca a migration (usado na prova de mutação).
set -euo pipefail
PORT="${1:-55436}"
BIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="/var/tmp/dizevolv-ops/pg-a8-$$"
mkdir -p "$D" && chown postgres "$D"
cleanup() { su postgres -s /bin/bash -c "$BIN/pg_ctl -D $D/data -m immediate stop >/dev/null 2>&1 || true"; rm -rf "$D"; }
trap cleanup EXIT
if ss -ltn | grep -q ":$PORT "; then echo "porta $PORT ocupada" >&2; exit 2; fi
su postgres -s /bin/bash -c "$BIN/initdb -D $D/data -A trust -U postgres >/dev/null && $BIN/pg_ctl -D $D/data -o '-p $PORT -k $D -c listen_addresses=127.0.0.1' -l $D/log -w start >/dev/null"
P=(psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${P[@]}" -c "create database a8" >/dev/null
MIG="${MIGRATION:-$ROOT/supabase/migrations/20261124140000_auto_a8_rascunho_ia.sql}"
for f in "$ROOT/supabase/tests/fin_local_stub.sql" "$ROOT/supabase/tests/p6_stub.sql" "$ROOT/supabase/tests/a8_stub.sql" "$MIG"; do
  "${P[@]}" -d a8 -f "$f" >/dev/null 2>"$D/err" || { echo "falhou aplicar $f" >&2; cat "$D/err" >&2; exit 1; }
done
OUT="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d a8 -q -At -F '|' -f "$ROOT/supabase/tests/a8_rascunho_ia.test.sql" 2>&1)" || true
echo "$OUT" | grep -E 'FALHA|ERROR|^[0-9]+\|[0-9]+$' || true
echo "$OUT" | tail -1 | grep -q '|0$' && echo "PROVA SQL OK ($(echo "$OUT" | tail -1 | cut -d'|' -f1) asserções)" || { echo "PROVA SQL COM FALHAS" >&2; exit 1; }
