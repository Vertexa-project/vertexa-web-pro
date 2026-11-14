// Documentos clínicos da clínica (Entrega 9). Recepção: lista e Reenviar (sem conteúdo). Profissional: só os dos seus pacientes. Financeiro e Estoquista não chegam aqui.
import { useState } from "react";

import { DemoBanner } from "@/components/documents/DemoBanner";
import { DocumentsList } from "@/components/documents/DocumentsList";
import { Field, NativeSelect } from "@/components/fin/FinUi";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Input } from "@/components/ui/input";
import { useDocContext } from "@/hooks/useClinicalDocs";
import type { DocListFilter } from "@/lib/api/clinicalDocs";
import { DOC_TYPES, DOC_TYPE_LABEL } from "@/lib/domain/clinicalDocs";
import { NoAccess } from "@/pages/finance/NoAccess";

export function DocumentsPage() {
  const { access, isLoading } = useDocContext();
  const [docType, setDocType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<"" | "active" | "invalidated">("");
  const [search, setSearch] = useState("");
  if (isLoading) return <LoadingState />;
  if (!access.can_list) return <NoAccess text="Você não tem acesso aos documentos clínicos. Peça ao administrador da clínica." />;
  const filter: DocListFilter = { docType: docType || null, from: from || null, to: to || null, status: status || null, search: search.trim() || null };
  const filtered = Boolean(docType || from || to || status || search.trim());
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader title="Documentos" description={access.kind === "front" ? "Documentos já assinados. Você pode reenviar; o conteúdo clínico não aparece para a Recepção." : "Receitas, atestados, exames e relatórios assinados."} />
      {access.is_demo ? <DemoBanner /> : null}
      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-5" role="search" aria-label="Filtros">
        <Field label="Tipo" htmlFor="docs-type">
          <NativeSelect id="docs-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">Todos</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Situação" htmlFor="docs-status">
          <NativeSelect id="docs-status" value={status} onChange={(e) => setStatus(e.target.value as "" | "active" | "invalidated")}>
            <option value="">Todas</option>
            <option value="active">Válidos</option>
            <option value="invalidated">Invalidados</option>
          </NativeSelect>
        </Field>
        <Field label="De" htmlFor="docs-from"><Input id="docs-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Até" htmlFor="docs-to"><Input id="docs-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="col-span-2 md:col-span-1">
          <Field label="Paciente ou título" htmlFor="docs-search"><Input id="docs-search" value={search} placeholder="Buscar" onChange={(e) => setSearch(e.target.value)} /></Field>
        </div>
      </div>
      <DocumentsList filter={filter} showPatient hideBanner emptyText={filtered ? "Nenhum documento com esses filtros." : "Nenhum documento assinado ainda."} />
    </div>
  );
}
