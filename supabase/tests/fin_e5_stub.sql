-- Stub MÍNIMO para a prova da FIN-E5 (coluna do app que a migration 20261114100000 usa e o stub base não tem). NÃO vai para produção.
alter table public.professionals add column if not exists type text;
