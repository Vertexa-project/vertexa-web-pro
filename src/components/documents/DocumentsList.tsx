// Lista de documentos (paciente, atendimento ou clínica). Recepção vê a lista e reenvia; só quem tem acesso clínico abre o conteúdo e invalida.
import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { DemoBanner } from "@/components/documents/DemoBanner";
import { DocumentViewDialog } from "@/components/documents/DocumentViewDialog";
import { FinTable } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDocContext, useDocMutations, useDocuments } from "@/hooks/useClinicalDocs";
import type { DocListFilter, DocRow } from "@/lib/api/clinicalDocs";
import { DEMO_BADGE, DOC_TYPE_LABEL, dateTimeBR, docErrorMessage } from "@/lib/domain/clinicalDocs";

export function DocumentsList({ filter, showPatient = false, emptyText = "Nenhum documento emitido ainda." }: { filter: DocListFilter; showPatient?: boolean; emptyText?: string }) {
  const { clinicId, access } = useDocContext();
  const q = useDocuments(clinicId, filter, access.can_list);
  const { resend } = useDocMutations();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!access.can_list) return null;
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  if (rows.length === 0) return <EmptyState icon={FileText} title={emptyText} />;

  async function doResend(row: DocRow) {
    setError(null); setNotice(null); setBusyId(row.id);
    try {
      const doc = await resend.mutateAsync(row.id);
      const { downloadClinicalDocumentPdf } = await import("@/lib/pdf/generateClinicalDocumentPdf");
      await downloadClinicalDocumentPdf(doc);
      setNotice("Reenvio registrado. O PDF foi baixado; nesta versão de demonstração nada é enviado ao paciente por WhatsApp ou e-mail.");
    } catch (e) { setError(docErrorMessage(e)); } finally { setBusyId(null); }
  }

  const anyDemo = rows.some((r) => r.is_demo);
  return (
    <div className="min-w-0 space-y-3">
      {anyDemo ? <DemoBanner /> : null}
      {notice ? <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="status">{notice}</p> : null}
      {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
      <FinTable<DocRow>
        label="Documentos clínicos" rows={rows} rowKey={(r) => r.id}
        columns={[
          { header: "Documento", role: "title", cell: (r) => <span>{r.title}{r.item_count > 0 ? <span className="ml-1 text-xs font-normal text-muted-foreground">({r.item_count} {r.item_count === 1 ? "item" : "itens"})</span> : null}</span> },
          { header: "Tipo", role: "badge", cell: (r) => (
            <span className="flex flex-wrap gap-1">
              <Badge tone="info">{DOC_TYPE_LABEL[r.doc_type]}</Badge>
              {r.is_demo ? <Badge tone="warning" title={DEMO_BADGE}>Demonstração</Badge> : null}
              {r.invalidated ? <Badge tone="destructive">Invalidado</Badge> : null}
            </span>
          ) },
          { header: "Assinado em", nowrap: true, cell: (r) => dateTimeBR(r.signed_at) },
          ...(showPatient ? [{ header: "Paciente", cell: (r: DocRow) => r.patient_name ?? "—" }] : []),
          { header: "Profissional", cell: (r) => <span>{r.professional_name ?? "—"}{r.professional_registry ? <span className="block text-xs text-muted-foreground">{r.professional_registry}</span> : null}</span> },
          ...(access.kind === "front" ? [{ header: "Reenvios", nowrap: true, cell: (r: DocRow) => String(r.resend_count) }] : []),
          { header: "Ações", role: "action" as const, cell: (r) => (
            <span className="flex flex-wrap gap-2">
              {access.can_content ? <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)}>Abrir</Button> : null}
              {access.can_resend && !r.invalidated ? (
                <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => void doResend(r)}>{busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Reenviar</Button>
              ) : null}
            </span>
          ) },
        ]}
      />
      {openId ? <DocumentViewDialog id={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
