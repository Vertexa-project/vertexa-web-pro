import { useState } from "react";
import { Loader2, ShieldAlert, UserCog } from "lucide-react";

import { AsyncSection } from "@/components/patient/AsyncSection";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import {
  useAssignDiscipline,
  useClinicProfessionalDisciplines,
  useDisciplinesList,
  useRevokeDiscipline,
} from "@/hooks/useDisciplines";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { isDisciplineDenied } from "@/lib/domain/disciplines";
import { initials, shortName } from "@/lib/domain/format";
import { captureException } from "@/lib/observability/sentry";

/**
 * Administração de DISCIPLINAS (WP-DISC B4). SÓ o admin da clínica: lista a equipe e concede/revoga
 * disciplinas INDIVIDUALMENTE (múltiplas por profissional). A autorização REAL é a RLS/RPC do banco
 * (assign/revoke_professional_discipline exigem admin da clínica do profissional-alvo); a UI espelha isso.
 *
 * WP-DISC-FIX: o admin PODE conceder/revogar disciplina a SI MESMO — sem isso a clínica solo (dono que
 * é o único profissional) nascia travada: sem disciplina ele não escreve nada clínico e não havia outra
 * pessoa para conceder. O bloqueio ao NÃO-admin continua: quem não é admin nem chega nesta tela (o
 * fail-closed acima), e o banco recusa de qualquer forma.
 */
export function DisciplinesAdminPage() {
  const { data: me } = useCurrentProfessional();
  const clinicId = me?.clinicId ?? null;
  // Visibilidade pelo SINAL REAL do banco (dono OU clinic_role='admin'), NÃO por profiles.role.
  const { isClinicAdmin, isLoading: adminLoading } = useIsClinicAdmin(clinicId);

  const disciplines = useDisciplinesList();
  const team = useClinicProfessionalDisciplines(clinicId);
  const assign = useAssignDiscipline(clinicId);
  const revoke = useRevokeDiscipline(clinicId);
  const [error, setError] = useState<string | null>(null);

  // Enquanto o sinal carrega, mostra um estado neutro (não pisca a tela de "sem acesso").
  if (adminLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Disciplinas da equipe" />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            Verificando suas permissões…
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fail-closed: só admin da clínica vê a administração.
  if (!isClinicAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Disciplinas da equipe" />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            Apenas o administrador da clínica gerencia as disciplinas da equipe.
          </CardContent>
        </Card>
      </div>
    );
  }

  function toggle(professionalId: string, discipline: string, has: boolean) {
    setError(null);
    const vars = { professionalId, discipline };
    const onError = (err: unknown) => {
      if (!isDisciplineDenied(err)) captureException(err, { source: "authz", scope: "assign-discipline" });
      setError(
        has
          ? "Não foi possível remover a disciplina."
          : "Não foi possível conceder a disciplina. Verifique se você é admin desta clínica.",
      );
    };
    if (has) revoke.mutate(vars, { onError });
    else assign.mutate(vars, { onError });
  }

  const busy = (professionalId: string, discipline: string) =>
    (assign.isPending &&
      assign.variables?.professionalId === professionalId &&
      assign.variables?.discipline === discipline) ||
    (revoke.isPending &&
      revoke.variables?.professionalId === professionalId &&
      revoke.variables?.discipline === discipline);

  const allDisciplines = disciplines.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disciplinas da equipe"
        description="Conceda ou revogue as disciplinas de cada profissional. A disciplina define o que ele pode ESCREVER (a leitura é integrada). Um profissional pode ter várias."
      />

      <AsyncSection
        isLoading={team.isLoading || disciplines.isLoading}
        isError={team.isError || disciplines.isError}
        isEmpty={(team.data?.length ?? 0) === 0}
        onRetry={() => {
          team.refetch();
          disciplines.refetch();
        }}
        emptyIcon={UserCog}
        emptyTitle="Nenhum profissional na clínica"
        emptyDescription="Cadastre profissionais para atribuir disciplinas."
      >
        {error ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="space-y-3">
          {(team.data ?? []).map((prof) => {
            const isSelf = me?.id === prof.professionalId;
            return (
              <Card key={prof.professionalId}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>{initials(prof.fullName ?? "?")}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {shortName(prof.fullName) ?? "Profissional"}
                        {isSelf ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {prof.disciplines.length > 0
                          ? `${prof.disciplines.length} disciplina(s)`
                          : "Sem disciplina — não escreve nada clínico"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {allDisciplines.map((d) => {
                      const has = prof.disciplines.includes(d.code);
                      // WP-DISC-FIX: `disabled` NÃO usa mais `isSelf` — o admin também administra as
                      // PRÓPRIAS disciplinas (era o que travava a clínica solo).
                      return (
                        <Button
                          key={d.code}
                          type="button"
                          size="sm"
                          variant={has ? "default" : "outline"}
                          disabled={busy(prof.professionalId, d.code)}
                          aria-pressed={has}
                          aria-label={`${has ? "Remover" : "Conceder"} ${d.label} de ${
                            isSelf ? "você" : prof.fullName ?? "profissional"
                          }`}
                          onClick={() => toggle(prof.professionalId, d.code, has)}
                        >
                          {d.label}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </AsyncSection>
    </div>
  );
}
