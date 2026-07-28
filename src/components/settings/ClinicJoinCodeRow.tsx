import { useState } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useClinic } from "@/hooks/useClinic";
import { useRotateClinicJoinCode } from "@/hooks/useClinicJoin";
import { rotateCodeErrorMessage, shareInviteText } from "@/lib/domain/clinicJoin";
import { captureException } from "@/lib/observability/sentry";

/**
 * Código de acesso da clínica (WP-JOIN-1) — SÓ para o admin. Ele copia e manda no WhatsApp; quem
 * recebe informa o código na tela de acesso pendente e o pedido cai na fila desta clínica.
 *
 * O botão de copiar leva a MENSAGEM PRONTA (link de login + código + o que vai acontecer), não só
 * os 8 caracteres soltos — é o que evita a ida e volta de "e agora, o que eu faço com isso?".
 *
 * Rotacionar INVALIDA o código anterior: fica atrás de confirmação porque quem já recebeu o antigo
 * e ainda não pediu acesso vai precisar do novo.
 */
export function ClinicJoinCodeRow({ clinicId }: { clinicId: string | null }) {
  const clinic = useClinic(clinicId);
  const rotate = useRotateClinicJoinCode(clinicId);
  const [copied, setCopied] = useState<"code" | "message" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const code = clinic.data?.join_code ?? null;

  async function copy(kind: "code" | "message") {
    if (!code) return;
    const text =
      kind === "code"
        ? code
        : shareInviteText(clinic.data?.name ?? "clínica", code, window.location.origin);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard bloqueado (permissão/contexto inseguro): não é erro de aplicação.
      setError("Não foi possível copiar automaticamente. Selecione o código e copie à mão.");
    }
  }

  function handleRotate() {
    setError(null);
    rotate.mutate(undefined, {
      onError: (err) => {
        setError(rotateCodeErrorMessage(err));
        captureException(err, { source: "join", scope: "rotate-code" });
      },
    });
  }

  if (clinic.isLoading) {
    return <span className="text-sm text-muted-foreground">Carregando…</span>;
  }

  // Banco anterior à migration 20260803090000 (ou clínica não resolvida): não inventa UI.
  if (!code) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex items-center gap-2">
        <code className="rounded-md border bg-muted px-2.5 py-1 font-mono text-sm tracking-[0.2em] text-foreground">
          {code}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void copy("code")}
          aria-label="Copiar o código"
          title="Copiar só o código"
        >
          {copied === "code" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void copy("message")}>
          {copied === "message" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          {copied === "message" ? "Convite copiado" : "Copiar convite"}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={rotate.isPending}>
              {rotate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              Gerar novo código
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Gerar um novo código de acesso?</AlertDialogTitle>
              <AlertDialogDescription>
                O código atual deixa de funcionar imediatamente. Quem já recebeu o código antigo e
                ainda não solicitou acesso vai precisar do novo. As solicitações já enviadas não são
                afetadas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={rotate.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleRotate} disabled={rotate.isPending}>
                Gerar novo código
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
