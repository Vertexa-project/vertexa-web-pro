#!/usr/bin/env bash
# Prova SQL da FIN-E9 (documentos clínicos com provedor em modo demonstração) num Postgres LOCAL descartável (nunca produção).
# Cria um cluster temporário, aplica stub + E1 a E9 (banco-modelo "base" com E1..E8; o banco da prova nasce dele), roda supabase/tests/fin_e9_documentos.test.sql
# e APAGA tudo ao sair. Uso: scripts/fin-e9-sql-proof.sh [porta]
# Variáveis: TEST_FILE=<arquivo> roda outra prova (regressão das Entregas 2 a 7) com a E9 aplicada; E9_MIG=<arquivo> aplica outra versão da migration da E8
# (verificação por mutação); SQL_ONLY=<arquivo.sql> só aplica as migrations e roda esse arquivo (diagnóstico); PERF=1 roda supabase/tests/fin_e9_perf.sql.
set -euo pipefail
PORT="${1:-55433}"
BIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="/var/tmp/dizevolv-ops/pg-fin-e9-$$"
mkdir -p "$D" && chown postgres "$D"
cleanup() { su postgres -s /bin/bash -c "$BIN/pg_ctl -D $D/data -m immediate stop >/dev/null 2>&1 || true"; rm -rf "$D"; }
trap cleanup EXIT
if ss -ltn | grep -q ":$PORT "; then echo "porta $PORT ocupada" >&2; exit 2; fi
su postgres -s /bin/bash -c "$BIN/initdb -D $D/data -A trust -U postgres >/dev/null && $BIN/pg_ctl -D $D/data -o '-p $PORT -k $D -c listen_addresses=127.0.0.1 -c jit=off' -l $D/log -w start >/dev/null"
P=(psql -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${P[@]}" -c "create database base" >/dev/null
apply() { "${P[@]}" -d "$1" -f "$ROOT/$2" >/dev/null 2>"$D/err" || { echo "falhou aplicar $2" >&2; cat "$D/err" >&2; exit 1; }; }
for f in supabase/tests/fin_local_stub.sql supabase/tests/fin_e9_stub.sql supabase/migrations/20261113100000_fin_e1_base.sql supabase/migrations/20261113180000_fin_e2_vendas.sql supabase/tests/fin_e4_stub.sql supabase/tests/fin_e5_stub.sql \
         supabase/migrations/20261113230000_fin_e3_estoque.sql supabase/migrations/20261114090000_fin_e4_atendimento.sql supabase/migrations/20261114100000_fin_e4_clinical_pro.sql supabase/tests/fin_e6_stub.sql \
         supabase/migrations/20261114180000_fin_e5_repasse.sql supabase/migrations/20261115100000_fin_e6_fechamento.sql supabase/migrations/20261115120000_fin_e6_answer_refresh.sql supabase/migrations/20261116100000_fin_e7_painel.sql supabase/migrations/20261116120000_fin_titles_by_settled.sql \
         supabase/migrations/20261117100000_fin_e8_inventario.sql supabase/migrations/20261117120000_fin_e8_reverse_keep_avg.sql; do
  apply base "$f"
done
"${P[@]}" -c "create database fine9 template base" >/dev/null
apply fine9 "${E9_MIG:-supabase/migrations/20261118100000_fin_e9_documentos.sql}"
if [ -n "${SQL_ONLY:-}" ]; then psql -h 127.0.0.1 -p "$PORT" -U postgres -d fine9 -f "$SQL_ONLY"; exit 0; fi
if [ -n "${PERF:-}" ]; then psql -h 127.0.0.1 -p "$PORT" -U postgres -d fine9 -q -At -F '|' -f "$ROOT/supabase/tests/fin_e9_perf.sql"; exit 0; fi
OUT="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d fine9 -q -At -F '|' -f "$ROOT/${TEST_FILE:-supabase/tests/fin_e9_documentos.test.sql}" 2>&1)" || true
echo "$OUT" | grep -E 'FALHA|ERROR|^[0-9]+\|[0-9]+$' || true
echo "$OUT" | tail -1 | grep -q '|0$' && echo "PROVA SQL OK ($(echo "$OUT" | tail -1 | cut -d'|' -f1) asserções)" || { echo "PROVA SQL COM FALHAS" >&2; exit 1; }
