import { Link } from "react-router-dom";
import { CircleDollarSign } from "lucide-react";

import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";

export function CommercialActivationPage() {
  const { data: me } = useCurrentProfessional();
  const { isClinicAdmin } = useIsClinicAdmin(me?.clinicId ?? null);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-10">
      <Brand markClassName="h-10 w-10" wordmarkClassName="text-xl" />
      <Card className="w-full max-w-lg overflow-hidden">
        <div className="h-1.5 bg-foreground" aria-hidden />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted">
              <CircleDollarSign className="h-4 w-4" aria-hidden />
            </span>
            Ative um plano para continuar
          </CardTitle>
          <CardDescription>
            Para continuar usando os recursos da clínica, escolha e ative um plano.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Isso ainda não significa pagamento recebido, Pix ativo ou produto liberado por
            entitlement. O próximo passo é o contrato comercial da clínica.
          </p>
          {isClinicAdmin ? (
            <Button asChild className="w-full">
              <Link to="/configuracoes/faturamento">Ir para Faturamento / Planos</Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Peça ao administrador da clínica para escolher e ativar um plano.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
