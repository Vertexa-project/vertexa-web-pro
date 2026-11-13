#!/bin/bash
# Prova as migrations clinical_* + RLS num Postgres local descartável (porta 5544, socket em /var/tmp/pgtest-consulta).
# Nunca toca produção. Uso: supabase/tests/run_local_proof.sh
set -e
cd "$(dirname "$0")/../.."
export PGOPTIONS="-c client_min_messages=warning"
P="psql -h /var/tmp/pgtest-consulta -p 5544 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists proof" -c "create database proof"
P="$P -d proof"
$P -f supabase/tests/local_stub.sql
for f in 20261113120000_clinical_encounters 20261113123000_clinical_versions_rpc 20261113130000_clinical_template_v2; do
  $P -f supabase/migrations/$f.sql
done
cat supabase/tests/clinical_rls_proof.sql > /tmp/proof_run.sql
echo "select case when ok then 'OK  ' else 'FAIL' end || ' ' || t || ' | ' || coalesce(detail,'') from res order by n; select 'total=' || count(*) || ' falhas=' || count(*) filter (where not ok) from res;" >> /tmp/proof_run.sql
$P -t -A -f /tmp/proof_run.sql
