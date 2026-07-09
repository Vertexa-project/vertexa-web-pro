import { useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";

import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-context";
import { useIdentity } from "@/hooks/useIdentity";

/**
 * Acesso pendente: sessão real válida, mas o usuário ainda NÃO está vinculado a um
 * profissional/clínica (1º login sem match por e-mail → profile 'pending'). Não vê dados de
 * ninguém. Onboarding/criação de clínica é escopo de outro WP; aqui só orientamos + sair.
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <Brand markClassName="h-10 w-10" wordmarkClassName="text-xl" />
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Clock className="h-7 w-7" aria-hidden />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Acesso pendente</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Seu login foi concluído{email ? <> como <span className="font-medium text-foreground">{email}</span></> : null}, mas
          sua conta ainda não está vinculada a uma clínica. Peça ao administrador da sua clínica
          para liberar o acesso.
        </p>
      </div>
      <Button variant="outline" onClick={handleSignOut}>
        Sair
      </Button>
    </div>
  );
}
