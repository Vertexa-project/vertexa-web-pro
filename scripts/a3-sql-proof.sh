#!/usr/bin/env bash
# Prova SQL da automação A3 (medicação) num Postgres LOCAL descartável (nunca produção). Aplica stub fin + E1 + E2 + stub A3 + E3 + migration A3
# (duas vezes: idempotência), roda supabase/tests/a3_medicacao.test.sql e apaga tudo. Uso: scripts/a3-sql-proof.sh [porta].
# MIGRATION=<arquivo> troca a migration (prova de mutação).
set -euo pipefail
PORT="${1:-55441}"
BIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="/var/tmp/dizevolv-ops/pg-a3-$$"
mkdir -p "$D" && chown postgres "$D"
cleanup() { su postgres -s /bin/bash -c "$BIN/pg_ctl -D $D/data -m immediate stop >/dev/null 2>&1 || true"; rm -rf "$D"; }
trap cleanup EXIT
if ss -ltn | grep -q ":$PORT "; then echo "porta $PORT ocupada" >&2; exit 2; fi
su postgres -s /bin/bash -c "$BIN/initdb -D $D/data -A trust -U postgres >/dev/null && $BIN/pg_ctl -D $D/data -o '-p $PORT -k $D -c listen_addresses=127.0.0.1' -l $D/log -w start >/dev/null"
P=(psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${P[@]}" -c "create database a3" >/dev/null
MIG="${MIGRATION:-$ROOT/supabase/migrations/20261124130000_auto_a3_medicacao.sql}"
for f in "$ROOT/supabase/tests/fin_local_stub.sql" "$ROOT/supabase/migrations/20261113100000_fin_e1_base.sql" "$ROOT/supabase/migrations/20261113180000_fin_e2_vendas.sql" \
         "$ROOT/supabase/tests/a3_stub.sql" "$ROOT/supabase/migrations/20261113230000_fin_e3_estoque.sql" "$MIG" "$MIG"; do
  "${P[@]}" -d a3 -f "$f" >/dev/null 2>"$D/err" || { echo "falhou aplicar $f" >&2; cat "$D/err" >&2; exit 1; }
done
OUT="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d a3 -q -At -F '|' -f "$ROOT/supabase/tests/a3_medicacao.test.sql" 2>&1)" || true
echo "$OUT" | grep -E 'FALHA|=>|ERROR|^[0-9]+\|[0-9]+$' || true
echo "$OUT" | tail -1 | grep -q '|0$' && echo "PROVA SQL OK ($(echo "$OUT" | tail -1 | cut -d'|' -f1) asserções; migration aplicada 2x)" || { echo "PROVA SQL COM FALHAS" >&2; exit 1; }
