import { useNavigate } from "react-router-dom";
import { Building2, KeyRound } from "lucide-react";

import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateClinicForm } from "@/components/onboarding/CreateClinicForm";
import { JoinClinicForm } from "@/components/onboarding/JoinClinicForm";
import { useAuth } from "@/providers/auth-context";
import { useIdentity } from "@/hooks/useIdentity";

/**
 * Acesso pendente: sessão real válida, mas a conta ainda NÃO está vinculada a um profissional/clínica
 * (1º login sem match por e-mail → profile 'pending'). Não vê dados de ninguém. Dois caminhos claros:
 *   (1) CRIAR a própria clínica → vira administradora na hora (RPC create_clinic_with_owner, WP-ONBOARDING);
 *   (2) PEDIR acesso a uma clínica existente com o CÓDIGO dela (RPC request_clinic_access, WP-JOIN-1)
 *       → o admin daquela clínica aprova e o acesso é liberado.
 *
 * O caminho (2) era, até o WP-JOIN-1, um texto morto mandando "falar com o administrador": ele não
 * tinha como atender, porque private.can_see_profile() é falsa para um profile pendente e o tornava
 * invisível. Com o código, o pedido nasce vinculado ao clinic_id e a fila do admin é RLS trivial.
 */
export function PendingAccessPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { email } = useIdentity();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-10">
      <Brand markClassName="h-10 w-10" wordmarkClassName="text-xl" />

      <div className="max-w-md space-y-1 text-center">
        <h1 className="text-lg font-semibold text-foreground">Falta um passo para começar</h1>
        <p className="text-sm text-muted-foreground">
          Seu login foi concluído
          {email ? (
            <>
              {" "}
              como <span className="font-medium text-foreground">{email}</span>
            </>
          ) : null}
          , mas sua conta ainda não está vinculada a uma clínica. Escolha como continuar:
        </p>
      </div>

      <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
        {/* Caminho 1: criar a própria clínica (profissional que administra a própria clínica). */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" aria-hidden />
              Criar minha clínica
            </CardTitle>
            <CardDescription>
              Você é profissional e vai administrar a própria clínica. Crie agora e entre como administradora.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateClinicForm />
          </CardContent>
        </Card>

        {/* Caminho 2: PEDIR acesso a uma clínica com o código dela (WP-JOIN-1). Antes daqui havia
            só um texto mandando "falar com o administrador" — que não tinha como atender, porque
            um profile pendente é invisível para ele. Agora o pedido nasce vinculado à clínica. */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" aria-hidden />
              Entrar em uma clínica
            </CardTitle>
            <CardDescription>
              Você foi chamada(o) para a equipe de uma clínica. Informe o código que ela te passou.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <JoinClinicForm />
            <Button variant="outline" onClick={handleSignOut} className="w-full">
              Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
