// Enviar ao app do paciente (redesign P6): prévia do PDF com a marca da clínica e botão Enviar. Quem enviou e quando ficam
// registrados (Documentos > "No app do paciente"); o paciente recebe um aviso e baixa em "Meus documentos" no app.
import { useEffect, useState } from "react";
import { Download, Loader2, Send } from "lucide-react";

import { PdfPagesPreview } from "./docimport/PdfPagesPreview";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSendPdf } from "@/hooks/useDeliveries";
import { deliveryFileName, deliveryTitle, sendErrorMessage, type DeliveryKind } from "@/lib/domain/deliveries";
import { captureException } from "@/lib/observability/sentry";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Extract<DeliveryKind, "treino" | "plano_alimentar">;
  patientId: string;
  patientName: string;
  professionalId: string | null;
  planTitle: string;
  /** Gera o PDF (com a marca da clínica). Chamado ao abrir; o mesmo arquivo serve à prévia e ao envio. */
  build: () => Promise<Blob>;
  /** Chamado depois do envio: o diálogo já fechou e quem chamou mostra o aviso. */
  onSent?: (message: string) => void;
}

const KIND_WORD = { treino: "treino", plano_alimentar: "plano alimentar" } as const;

export function SendToPatientDialog({ open, onOpenChange, kind, patientId, patientName, professionalId, planTitle, build, onSent }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = useSendPdf(patientId);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBlob(null);
    setBytes(null);
    setError(null);
    setBuilding(true);
    build()
      .then(async (b) => {
        const ab = await b.arrayBuffer();
        if (alive) {
          setBlob(b);
          setBytes(ab);
        }
      })
      .catch((e) => {
        captureException(e, { source: "plan-pdf", scope: kind });
        if (alive) setError("Não foi possível montar o PDF. Tente novamente.");
      })
      .finally(() => {
        if (alive) setBuilding(false);
      });
    return () => {
      alive = false;
    };
    // build muda a cada render do pai; só reabre quando o diálogo abre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fileName = deliveryFileName(kind, patientName);

  function download() {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleSend() {
    if (!blob || !professionalId) return;
    setError(null);
    send.mutate(
      { patientId, professionalId, blob, fileName, kind, title: deliveryTitle(kind, planTitle) },
      {
        onSuccess: () => {
          onSent?.(`Enviado. O ${KIND_WORD[kind]} já está no app do paciente e registrado em Documentos.`);
          onOpenChange(false);
        },
        onError: (e) => {
          captureException(e, { source: "delivery", scope: kind });
          setError(sendErrorMessage(e, kind));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar {KIND_WORD[kind]} ao app do paciente</DialogTitle>
          <DialogDescription>
            PDF com a marca da clínica. Confira a prévia antes de enviar; o paciente recebe um aviso e baixa em Meus documentos.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {building ? (
            <div role="status" aria-label="Montando o PDF" className="space-y-2 rounded-md border bg-muted/30 p-3" data-testid="pdf-building">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Montando o PDF…
              </p>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : bytes ? (
            <div className="relative max-h-[50vh] overflow-y-auto overflow-x-hidden rounded-md border bg-muted/30">
              <PdfPagesPreview bytes={bytes} />
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">WhatsApp e e-mail ficam para a próxima versão.</p>
        </DialogBody>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={send.isPending}>
            Voltar
          </Button>
          <Button variant="outline" onClick={download} disabled={!blob}>
            <Download className="h-4 w-4" aria-hidden />
            Baixar PDF
          </Button>
          <Button onClick={handleSend} disabled={!blob || !professionalId || send.isPending} aria-busy={send.isPending}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {send.isPending ? "Enviando…" : "Enviar ao app do paciente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
