#!/usr/bin/env bash
# Prova SQL da parte 6 do redesign (treino publicado, envio ao app, lembretes) num Postgres LOCAL descartável (nunca produção).
# Aplica stub local (fin_local_stub + p6_stub) + migration P6, roda supabase/tests/p6_treino_envio_lembretes.test.sql e apaga tudo.
# Uso: scripts/p6-sql-proof.sh [porta]. MIGRATION=<arquivo> troca a migration (usado na prova de mutação).
set -euo pipefail
PORT="${1:-55436}"
BIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="/var/tmp/dizevolv-ops/pg-p6-$$"
mkdir -p "$D" && chown postgres "$D"
cleanup() { su postgres -s /bin/bash -c "$BIN/pg_ctl -D $D/data -m immediate stop >/dev/null 2>&1 || true"; rm -rf "$D"; }
trap cleanup EXIT
if ss -ltn | grep -q ":$PORT "; then echo "porta $PORT ocupada" >&2; exit 2; fi
su postgres -s /bin/bash -c "$BIN/initdb -D $D/data -A trust -U postgres >/dev/null && $BIN/pg_ctl -D $D/data -o '-p $PORT -k $D -c listen_addresses=127.0.0.1' -l $D/log -w start >/dev/null"
P=(psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${P[@]}" -c "create database p6" >/dev/null
MIG="${MIGRATION:-$ROOT/supabase/migrations/20261122100000_redesign_p6_treino_envio_lembretes.sql}"
for f in "$ROOT/supabase/tests/fin_local_stub.sql" "$ROOT/supabase/tests/p6_stub.sql" "$MIG"; do
  "${P[@]}" -d p6 -f "$f" >/dev/null 2>"$D/err" || { echo "falhou aplicar $f" >&2; cat "$D/err" >&2; exit 1; }
done
OUT="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d p6 -q -At -F '|' -f "$ROOT/supabase/tests/p6_treino_envio_lembretes.test.sql" 2>&1)" || true
echo "$OUT" | grep -E 'FALHA|ERROR|^[0-9]+\|[0-9]+$' || true
echo "$OUT" | tail -1 | grep -q '|0$' && echo "PROVA SQL OK ($(echo "$OUT" | tail -1 | cut -d'|' -f1) asserções)" || { echo "PROVA SQL COM FALHAS" >&2; exit 1; }
