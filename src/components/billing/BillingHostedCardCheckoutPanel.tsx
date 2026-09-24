import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useCreateHostedCardCheckout } from "@/hooks/useBillingHostedCardCheckout";
import { captureException } from "@/lib/observability/sentry";

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("identity_incomplete")) return "Salve os dados de cobrança antes de continuar com o cartão.";
  if (code.includes("outcome_unknown_requires_reconciliation")) return "Estamos confirmando uma tentativa anterior. Aguarde antes de iniciar outra.";
  if (code.includes("attempt_expired")) return "Esta tentativa expirou. Inicie uma nova tentativa de pagamento.";
  if (code.includes("checkout_paid_awaiting_reconciliation")) return "O checkout já foi pago e está aguardando a confirmação segura da assinatura.";
  return "Não foi possível abrir o checkout seguro agora. Tente novamente em instantes.";
}

export function BillingHostedCardCheckoutPanel({
  clinicId,
  returnState,
}: {
  clinicId: string;
  returnState?: "success" | "cancel" | "expired";
}) {
  const create = useCreateHostedCardCheckout(clinicId);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      const { hostedUrl } = await create.mutateAsync();
      window.location.assign(hostedUrl);
    } catch (cause) {
      captureException(cause, { source: "billing", scope: "hosted-card-checkout" });
      setError(errorMessage(cause));
    }
  }

  const returnCopy = returnState === "success"
    ? "Recebemos seu retorno. A confirmação financeira é feita somente pelo processamento seguro do provedor."
    : returnState === "expired"
      ? "O checkout expirou após 60 minutos. O contrato e o acesso não foram alterados."
      : returnState === "cancel"
        ? "O checkout foi cancelado. O contrato e o acesso não foram alterados."
        : null;

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <p className="text-sm font-medium">Cartão de crédito</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Você será direcionado ao checkout hospedado e seguro. A tentativa vale 60 minutos; o retorno no navegador não confirma pagamento.
      </p>
      {returnCopy ? <p className="mt-3 text-sm text-muted-foreground" role="status">{returnCopy}</p> : null}
      <Button className="mt-3" disabled={create.isPending} onClick={() => void start()}>
        {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
        {returnState === "expired" || returnState === "cancel" ? "Tentar novamente" : "Continuar para pagamento seguro"}
      </Button>
      {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
