import { useNavigate } from "react-router-dom";
import { Building2, ShieldOff } from "lucide-react";

import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/providers/auth-context";
import { useIdentity } from "@/hooks/useIdentity";
import type { ClinicMembership } from "@/lib/api/professionalStatus";

/**
 * O ACESSO FOI DESATIVADO — a tela que existe para a pessoa DISTINGUIR "fui cortado" de
 * "o sistema quebrou".
 *
 * POR QUE ELA PRECISA EXISTIR (medido, não suposto): quem é desativado continua com sessão,
 * profile e linha em `professionals` — e `professionals_select` deixa qualquer um ler a PRÓPRIA
 * linha (`profile_id = current_profile_id()`). Ou seja, a identidade resolve como ATIVA e o
 * painel monta inteiro. Aí TODA consulta escopada por clínica volta VAZIA, sem erro: a listagem
 * de pacientes diz "nenhuma paciente", o kanban fica sem coluna, Configurações perde o nome da
 * clínica. Um painel normal e vazio é a pior das três hipóteses — é UI que mente.
 *
 * A ÚNICA fonte que sabe responder é a RPC `my_clinic_memberships` (WP-TEAM-2b-ii): o desativado
 * perdeu `clinics_select` (o registro inteiro de clinics carrega o `join_code`, que é credencial
 * de entrada), e a RPC devolve APENAS clinic_id, nome e o status DELE. Esta tela não inventa nada
 * além disso — não diz quem desativou, nem quando, nem por quê, porque a RPC não devolve isso e
 * inventar seria pior do que não dizer.
 */
export function ClinicAccessRevokedPage({ clinics }: { clinics: readonly ClinicMembership[] }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { email } = useIdentity();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  const names = clinics.map((c) => c.clinicName);
  const only = names.length === 1 ? names[0] : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-10">
      <Brand markClassName="h-10 w-10" wordmarkClassName="text-xl" />

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldOff className="h-5 w-5 text-muted-foreground" aria-hidden />
            Seu acesso foi desativado
          </CardTitle>
          <CardDescription>
            {only ? (
              <>
                O administrador de <span className="font-medium text-foreground">{only}</span>{" "}
                desativou o seu acesso. Sua conta continua existindo
                {email ? (
                  <>
                    {" "}
                    (<span className="font-medium text-foreground">{email}</span>)
                  </>
                ) : null}
                , mas você não vê mais os pacientes nem as conversas dessa clínica.
              </>
            ) : (
              <>
                O seu acesso foi desativado nas clínicas em que você tinha cadastro
                {names.length > 0 ? <> ({names.join(", ")})</> : null}. Sua conta continua
                existindo, mas você não vê mais os pacientes nem as conversas.
              </>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* O que fazer. Não há botão de "pedir de volta": reativar é ato do admin, com trilha —
              e a porta da frente (solicitar acesso com o código) RECUSA quem tem cadastro
              desativado, de propósito, para não devolver um "aprovado" que não devolve acesso. */}
          <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              Se isso não era esperado, fale com o administrador da clínica: só ele pode reativar o
              seu acesso.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            O que você registrou continua no sistema, com a sua autoria — desativar não apaga
            histórico.
          </p>

          <Button variant="outline" onClick={handleSignOut} className="w-full">
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * SEM CLÍNICA NENHUMA — estado honesto e DIFERENTE do anterior: aqui não houve corte, nunca houve
 * vínculo com clínica. Reaproveitar a tela de desativação diria uma coisa que não aconteceu.
 *
 * Não é o mesmo caso do `PendingAccessPage` (profile 'pending', que oferece criar clínica ou pedir
 * acesso): aqui existe linha de profissional resolvida, mas a RPC não devolveu nenhuma clínica —
 * o que, na prática, significa cadastro incompleto do lado da clínica. A tela diz isso e para.
 */
export function NoClinicMembershipPage() {
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

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden />
            Sua conta não está em nenhuma clínica
          </CardTitle>
          <CardDescription>
            Seu login funcionou
            {email ? (
              <>
                {" "}
                (<span className="font-medium text-foreground">{email}</span>)
              </>
            ) : null}
            , mas não encontramos nenhuma clínica ligada a você. Isso não é uma desativação: é
            cadastro incompleto. Peça ao administrador da clínica para incluir você na equipe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleSignOut} className="w-full">
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
