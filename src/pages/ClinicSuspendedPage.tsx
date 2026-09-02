import { useNavigate } from "react-router-dom";
import { Pause } from "lucide-react";

import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/providers/auth-context";
import { useIdentity } from "@/hooks/useIdentity";
import type { ClinicMembership } from "@/lib/api/professionalStatus";

/**
 * Clínica suspensa — estado explícito ANTES do painel clínico.
 * Não é desativação da pessoa, não é pending, não é "sem clínica".
 * O motivo administrativo NÃO aparece aqui.
 */
export function ClinicSuspendedPage({ clinics }: { clinics: readonly ClinicMembership[] }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { email } = useIdentity();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  const suspended = clinics.filter((c) => (c.clinicStatus ?? "active") === "suspended");
  const names = (suspended.length > 0 ? suspended : clinics).map((c) => c.clinicName);
  const only = names.length === 1 ? names[0] : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-10">
      <Brand markClassName="h-10 w-10" wordmarkClassName="text-xl" />

      <Card className="w-full max-w-lg overflow-hidden">
        <div className="h-1.5 bg-amber-500" aria-hidden />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
              <Pause className="h-4 w-4" aria-hidden />
            </span>
            Esta clínica está temporariamente suspensa
          </CardTitle>
          <CardDescription>
            {only ? (
              <>
                O acesso aos recursos de{" "}
                <span className="font-medium text-foreground">{only}</span> está indisponível no
                momento. Os dados permanecem preservados
                {email ? (
                  <>
                    {" "}
                    (<span className="font-medium text-foreground">{email}</span>)
                  </>
                ) : null}
                .
              </>
            ) : (
              <>
                O acesso aos recursos da clínica está indisponível no momento
                {names.length > 0 ? <> ({names.join(", ")})</> : null}. Os dados permanecem
                preservados.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Nada foi apagado. Quando a clínica for reativada, o acesso operacional volta com a
            mesma equipe e os mesmos vínculos.
          </p>
          <Button variant="outline" onClick={handleSignOut} className="w-full">
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
