import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  useEnsureClinicCustomerFromIdentity,
  useExecuteClinicPixAuthorization,
  usePrepareClinicPixAuthorization,
  useReissueClinicPixAuthorization,
} from "@/hooks/useBillingPixCheckout";
import { useClinicCommercialCheckout } from "@/hooks/useBillingCheckout";
import type { ClinicCommercialCheckout } from "@/lib/domain/billingCheckout";
import {
  PIX_BANK_COPY,
  PIX_RELOAD_COPY,
  pixProductLabel,
  resolvePixCheckoutSurface,
  type TransientPixQr,
} from "@/lib/domain/billingPixCheckout";
import { captureException } from "@/lib/observability/sentry";

function pixErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("identity_incomplete") || message.includes("BILLING_IDENTITY")) {
    return "Salve os dados de cobrança antes de configurar o Pix.";
  }
  if (message.includes("forbidden") || message.includes("BILLING_NOT_CLINIC_ADMIN")) {
    return "Apenas o administrador da clínica pode configurar o Pix Automático.";
  }
  if (message.includes("BILLING_REISSUE_NOT_REFUSED")) {
    return "Só é possível gerar uma nova autorização depois de uma recusa.";
  }
  return "Não foi possível continuar o Pix Automático agora. Tente novamente em instantes.";
}

export function BillingPixCheckoutPanel({
  clinicId,
  checkout,
}: {
  clinicId: string;
  checkout: ClinicCommercialCheckout;
}) {
  const [confirming, setConfirming] = useState(false);
  const [sessionQr, setSessionQr] = useState<TransientPixQr | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const live = useClinicCommercialCheckout(clinicId, true);
  const view = live.data ?? checkout;
  const surface = resolvePixCheckoutSurface({ checkout: view, sessionQr, confirming });

  const ensureCustomer = useEnsureClinicCustomerFromIdentity(clinicId);
  const prepare = usePrepareClinicPixAuthorization(clinicId);
  const execute = useExecuteClinicPixAuthorization();
  const reissue = useReissueClinicPixAuthorization(clinicId);

  useEffect(() => {
    return () => {
      setSessionQr(null);
    };
  }, []);

  useEffect(() => {
    if (surface !== "qr" && surface !== "awaiting") return;
    const id = window.setInterval(() => {
      void live.refetch();
    }, 8000);
    return () => window.clearInterval(id);
  }, [surface, live]);

  async function startAuthorization() {
    setBusy(true);
    setError(null);
    try {
      await ensureCustomer.mutateAsync();
      const prepared = await prepare.mutateAsync();
      if (!prepared.operationId) throw new Error("prepare_missing_operation");
      const executed = await execute.mutateAsync(prepared.operationId);
      if (executed.qrAvailable && executed.immediateQrCode?.payload) {
        setSessionQr(executed.immediateQrCode);
      } else {
        setSessionQr(null);
      }
      setConfirming(false);
      await live.refetch();
    } catch (err) {
      captureException(err);
      setError(pixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function recoverRefused() {
    setBusy(true);
    setError(null);
    setSessionQr(null);
    try {
      await reissue.mutateAsync();
      setConfirming(true);
      await live.refetch();
    } catch (err) {
      captureException(err);
      setError(pixErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyPayload() {
    if (!sessionQr?.payload) return;
    await navigator.clipboard.writeText(sessionQr.payload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <p className="text-sm font-medium">Pix Automático</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Estado atual: {pixProductLabel(view.pixAuthorizationStatus)}.
        {view.pixGeneration ? ` Tentativa ${view.pixGeneration}.` : ""}
      </p>

      {surface === "identity" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Salve os dados de cobrança desta clínica antes de gerar o Pix.
        </p>
      ) : null}

      {surface === "cta" ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            A contratação comercial já está registrada. O próximo passo é autorizar as cobranças recorrentes no
            aplicativo do seu banco.
          </p>
          <Button onClick={() => setConfirming(true)}>Configurar Pix Automático</Button>
        </div>
      ) : null}

      {surface === "confirm" ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Vamos criar o cliente de cobrança com os dados fiscais já salvos, preparar a autorização mensal pelo
            preço do contrato e mostrar um QR temporário. {PIX_BANK_COPY}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void startAuthorization()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Gerar autorização Pix
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Agora não
            </Button>
          </div>
        </div>
      ) : null}

      {surface === "qr" && sessionQr ? (
        <div className="mt-4 space-y-4">
          <div className="mx-auto w-fit rounded-md bg-background p-3 shadow-sm ring-1 ring-border">
            {sessionQr.encodedImage ? (
              <img
                alt="QR Code do Pix Automático"
                className="h-52 w-52"
                src={
                  sessionQr.encodedImage.startsWith("data:")
                    ? sessionQr.encodedImage
                    : `data:image/png;base64,${sessionQr.encodedImage}`
                }
              />
            ) : (
              <div className="flex h-52 w-52 items-center justify-center text-center text-xs text-muted-foreground">
                Use o Pix Copia e Cola abaixo
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{PIX_BANK_COPY}</p>
          <Button variant="secondary" onClick={() => void copyPayload()}>
            {copied ? "Código copiado" : "Copiar Pix Copia e Cola"}
          </Button>
        </div>
      ) : null}

      {surface === "awaiting" ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">{PIX_RELOAD_COPY.title}</p>
          <p className="text-sm text-muted-foreground">{PIX_RELOAD_COPY.body}</p>
        </div>
      ) : null}

      {surface === "active" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          A autorização está ativa. Isso não libera o produto automaticamente e não confirma um pagamento avulso.
        </p>
      ) : null}

      {surface === "refused" ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Esta autorização foi recusada. Você pode iniciar uma nova tentativa sem alterar o contrato comercial.
          </p>
          <Button disabled={busy} onClick={() => void recoverRefused()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Gerar nova autorização
          </Button>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
