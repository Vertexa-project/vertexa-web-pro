import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";

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
import { useAuth } from "@/providers/auth-context";
import { useIdentity } from "@/hooks/useIdentity";

/**
 * Acesso pendente: sessão real válida, mas a conta ainda NÃO está vinculada a um profissional/clínica
 * (1º login sem match por e-mail → profile 'pending'). Não vê dados de ninguém. Dois caminhos claros:
 *   (1) CRIAR a própria clínica → vira administradora na hora (RPC create_clinic_with_owner, WP-ONBOARDING);
 *   (2) AGUARDAR o cadastro por uma clínica que a convidou (comportamento anterior — pacientes/convidados).
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

        {/* Caminho 2: aguardar cadastro por uma clínica (convidados/pacientes) — comportamento anterior. */}
        <Card>
          <CardHeader>
            <CardTitle>Fui cadastrada por uma clínica</CardTitle>
            <CardDescription>
              Se uma clínica está te cadastrando como profissional ou paciente, o acesso é liberado por ela.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Peça ao administrador da sua clínica para concluir seu cadastro. Assim que ele liberar, seu
              acesso aparece aqui automaticamente.
            </p>
            <Button variant="outline" onClick={handleSignOut} className="w-full">
              Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
