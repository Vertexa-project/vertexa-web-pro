import { useState } from "react";
import { History } from "lucide-react";

import { ExportButtons, Field, NativeSelect, TableShell, Td, Th } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAudit, useFinContext } from "@/hooks/useFin";
import type { AuditEntry } from "@/lib/api/finRegistry";
import { AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, diffAudit } from "@/lib/domain/finAudit";
import { finCan } from "@/lib/domain/finAccess";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";

const PAGE = 50;
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

const columns: ExportColumn<AuditEntry>[] = [
  { header: "Quando", value: (e) => fmtWhen(e.at) },
  { header: "Quem", value: (e) => e.user_name },
  { header: "Cadastro", value: (e) => AUDIT_ENTITY_LABEL[e.entity] ?? e.entity },
  { header: "Ação", value: (e) => AUDIT_ACTION_LABEL[e.action] ?? e.action },
  { header: "Mudanças (antes → depois)", value: (e) => diffAudit(e.before, e.after).map((c) => `${c.label}: ${c.before} → ${c.after}`).join(" | ") },
  { header: "Motivo", value: (e) => e.reason },
];

/** Cadastros › Histórico (admin e gestor): quem, quando, antes → depois, motivo. */
export function AuditTab() {
  const { clinicId, access } = useFinContext();
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const allowed = finCan(access, "audit");
  const q = useAudit(clinicId, {
    entity: entity || null,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
    to: to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString() : null,
    limit,
  }, allowed);
  if (!clinicId) return <LoadingState />;
  if (!allowed) return <NoAccess text="O histórico é visto pelo administrador e pelo gestor." />;
  const rows = q.data ?? [];

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <Field label="Cadastro" htmlFor="aud-entity">
          <NativeSelect id="aud-entity" value={entity} onChange={(e) => { setEntity(e.target.value); setLimit(PAGE); }}>
            <option value="">Todos</option>
            {Object.entries(AUDIT_ENTITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </NativeSelect>
        </Field>
        <Field label="De" htmlFor="aud-from"><Input id="aud-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setLimit(PAGE); }} /></Field>
        <Field label="Até" htmlFor="aud-to"><Input id="aud-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setLimit(PAGE); }} /></Field>
      </div>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={History} title="Nenhuma mudança registrada" description="Quando alguém criar, alterar ou desativar um cadastro, o registro aparece aqui." />
      ) : (
        <>
          <ExportButtons columns={columns} rows={rows} filename="historico-financeiro" sheetName="Histórico" />
          <TableShell label="Histórico de mudanças">
            <thead><tr><Th>Quando</Th><Th>Quem</Th><Th>Cadastro</Th><Th>Ação</Th><Th>Antes → depois</Th><Th>Motivo</Th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const changes = diffAudit(e.before, e.after);
                return (
                  <tr key={e.id} className="align-top">
                    <Td className="whitespace-nowrap">{fmtWhen(e.at)}</Td>
                    <Td>{e.user_name ?? "—"}</Td>
                    <Td>{AUDIT_ENTITY_LABEL[e.entity] ?? e.entity}</Td>
                    <Td><Badge tone={e.action === "deactivate" ? "destructive" : e.action === "create" ? "success" : e.action === "view_sensitive" ? "warning" : "info"}>{AUDIT_ACTION_LABEL[e.action] ?? e.action}</Badge></Td>
                    <Td className="min-w-64">
                      {changes.length === 0 ? <span className="text-muted-foreground">—</span> : (
                        <ul className="space-y-0.5">
                          {changes.slice(0, 6).map((c) => <li key={c.field}><span className="text-muted-foreground">{c.label}:</span> {c.before} → <strong className="font-medium">{c.after}</strong></li>)}
                          {changes.length > 6 ? <li className="text-muted-foreground">+{changes.length - 6} campos</li> : null}
                        </ul>
                      )}
                    </Td>
                    <Td>{e.reason ?? "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
          {rows.length >= limit ? <Button variant="outline" onClick={() => setLimit(limit + PAGE)}>Carregar mais</Button> : null}
        </>
      )}
    </div>
  );
}
