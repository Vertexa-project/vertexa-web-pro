-- ⚠️ TEMPORÁRIA — SPRINT. Versiona a ÚLTIMA policy de escrita sprint que faltava
-- no repo (aplicada via MCP na etapa 4c-2b do app). Sem mudança de comportamento:
-- recria EXATAMENTE o que já existe no banco (INSERT anon,authenticated,
-- with check (true)), idempotente (drop if exists + create).
--
-- adherence_snapshots: o app paciente ESCREVE o VRI (4c-2b); a web só LÊ
-- (sprint_read_all, SELECT). Substituir por RLS por papel/clínica antes de
-- qualquer dado real — ver docs/PENDENCIAS.md #14.

drop policy if exists sprint_adherence_write on public.adherence_snapshots;
create policy sprint_adherence_write on public.adherence_snapshots
  for insert to anon, authenticated with check (true);
