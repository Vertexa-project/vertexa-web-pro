#!/usr/bin/env bash
# Prova SQL da parte 4 do redesign (importar/exportar pacientes) num Postgres LOCAL descartável (nunca produção).
# Aplica stub + FIN-E1 (papéis/fin_has_role) + stub P4 + migration P4, roda supabase/tests/p4_importar_exportar.test.sql e apaga tudo.
# Uso: scripts/p4-sql-proof.sh [porta]. MIGRATION=<arquivo> troca a migration (usado na prova de mutação).
set -euo pipefail
PORT="${1:-55434}"
BIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="/var/tmp/dizevolv-ops/pg-p4-$$"
mkdir -p "$D" && chown postgres "$D"
cleanup() { su postgres -s /bin/bash -c "$BIN/pg_ctl -D $D/data -m immediate stop >/dev/null 2>&1 || true"; rm -rf "$D"; }
trap cleanup EXIT
if ss -ltn | grep -q ":$PORT "; then echo "porta $PORT ocupada" >&2; exit 2; fi
su postgres -s /bin/bash -c "$BIN/initdb -D $D/data -A trust -U postgres >/dev/null && $BIN/pg_ctl -D $D/data -o '-p $PORT -k $D -c listen_addresses=127.0.0.1' -l $D/log -w start >/dev/null"
P=(psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${P[@]}" -c "create database p4" >/dev/null
MIG="${MIGRATION:-$ROOT/supabase/migrations/20261120100000_redesign_p4_importar_exportar_pacientes.sql}"
for f in "$ROOT/supabase/tests/fin_local_stub.sql" "$ROOT/supabase/migrations/20261113100000_fin_e1_base.sql" "$ROOT/supabase/tests/p4_stub.sql" "$MIG"; do
  "${P[@]}" -d p4 -f "$f" >/dev/null 2>"$D/err" || { echo "falhou aplicar $f" >&2; cat "$D/err" >&2; exit 1; }
done
OUT="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d p4 -q -At -F '|' -f "$ROOT/supabase/tests/p4_importar_exportar.test.sql" 2>&1)" || true
echo "$OUT" | grep -E 'FALHA|ERROR|^[0-9]+\|[0-9]+$' || true
echo "$OUT" | tail -1 | grep -q '|0$' && echo "PROVA SQL OK ($(echo "$OUT" | tail -1 | cut -d'|' -f1) asserções)" || { echo "PROVA SQL COM FALHAS" >&2; exit 1; }
