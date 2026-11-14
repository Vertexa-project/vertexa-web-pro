import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { DemoBanner } from "@/components/documents/DemoBanner";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDocMutations } from "@/hooks/useClinicalDocs";
import { getDocument } from "@/lib/api/clinicalDocs";
import { DOC_TYPE_LABEL, dateTimeBR, docErrorMessage, formatCpf, isoDateBR } from "@/lib/domain/clinicalDocs";
import { ReasonDialog } from "@/pages/finance/appointments/ReasonDialog";

/** Documento aberto: conteúdo, itens prescritos, dados do momento da assinatura. Cada abertura vai ao log de auditoria (no servidor). */
export function DocumentViewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["docs", "full", id], queryFn: () => getDocument(id), staleTime: 0, gcTime: 0 });
  const { invalidate } = useDocMutations();
  const [inval, setInval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const d = q.data;

  async function pdf() {
    if (!d) return;
    setPdfBusy(true); setError(null);
    try { const { downloadClinicalDocumentPdf } = await import("@/lib/pdf/generateClinicalDocumentPdf"); await downloadClinicalDocumentPdf(d); }
    catch (e) { setError(docErrorMessage(e)); } finally { setPdfBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{d ? d.title : "Documento"}</DialogTitle>
          <DialogDescription>{d ? `${DOC_TYPE_LABEL[d.doc_type]} · assinado em ${dateTimeBR(d.signed_at)}` : "Carregando…"}</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-w-0 space-y-4">
          {q.isLoading ? <LoadingState /> : q.isError || !d ? <ErrorState onRetry={() => void q.refetch()} /> : (
            <>
              {d.is_demo ? <DemoBanner /> : null}
              {d.invalidated ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="status"><Badge tone="destructive">Invalidado</Badge> em {dateTimeBR(d.invalidated_at)} — {d.invalidated_reason}</p> : null}
              <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                <div className="min-w-0"><p className="text-xs text-muted-foreground">Paciente</p><p className="break-words font-medium">{d.patient.name}</p><p className="break-words text-xs text-muted-foreground">Nascimento {isoDateBR(d.patient.birth_date)}{d.patient.cpf ? ` · CPF ${formatCpf(d.patient.cpf)}` : ""}</p>{d.patient.address ? <p className="break-words text-xs text-muted-foreground">{d.patient.address}</p> : null}</div>
                <div className="min-w-0"><p className="text-xs text-muted-foreground">Profissional</p><p className="break-words font-medium">{d.professional.name}</p><p className="break-words text-xs text-muted-foreground">{[d.professional.registry_number, d.professional.specialty].filter(Boolean).join(" · ")}</p>{d.sncr_number ? <p className="text-xs text-muted-foreground">SNCR {d.sncr_number}</p> : <p className="text-xs text-muted-foreground">Número SNCR: não se aplica (demonstração)</p>}</div>
              </div>
              {d.items.length > 0 ? (
                <ul aria-label="Itens prescritos" className="min-w-0 divide-y rounded-md border text-sm">
                  {d.items.map((it, i) => (
                    <li key={i} className="min-w-0 px-3 py-2"><p className="break-words font-medium">{it.name}</p>{it.dose || it.posology || it.quantity ? <p className="break-words text-muted-foreground">{[it.dose, it.posology, it.quantity ? `Quantidade: ${it.quantity}` : ""].filter(Boolean).join(" — ")}</p> : null}</li>
                  ))}
                </ul>
              ) : null}
              {d.content.trim() ? <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/20 px-3 py-2 text-sm">{d.content}</p> : null}
              {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            </>
          )}
        </DialogBody>
        <DialogFooter className="flex-wrap gap-2">
          {d && !d.invalidated ? <Button type="button" variant="outline" onClick={() => setInval(true)}>Invalidar</Button> : null}
          {d ? <Button type="button" variant="outline" onClick={() => void pdf()} disabled={pdfBusy}>{pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Baixar PDF</Button> : null}
          <Button type="button" onClick={onClose}>Fechar</Button>
        </DialogFooter>
        {inval && d ? (
          <ReasonDialog title="Invalidar documento" label="Motivo da invalidação" submitLabel="Invalidar" pending={invalidate.isPending} error={error}
            description="O documento continua guardado, com a marca de invalidado, o motivo e quem invalidou. Nada é apagado."
            onClose={() => setInval(false)}
            onSubmit={(reason) => { setError(null); invalidate.mutate({ id: d.id, reason }, { onSuccess: () => { setInval(false); void q.refetch(); }, onError: (e) => setError(docErrorMessage(e)) }); }} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
