import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Clock3, Loader2, ShieldAlert, UserCheck, UserCog, X } from "lucide-react";

import { AsyncSection } from "@/components/patient/AsyncSection";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useClinicProfessionalDisciplines, useDisciplinesList } from "@/hooks/useDisciplines";
import {
  useApproveJoinRequest,
  usePendingJoinRequests,
  useRejectJoinRequest,
} from "@/hooks/useClinicJoin";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { formatRelative, initials, shortName } from "@/lib/domain/format";
import {
  decisionErrorMessage,
  isExpectedDecisionError,
  requesterLabel,
  resolveTeamAccess,
  summarizeTeam,
} from "@/lib/domain/teamManagement";
import type { ClinicJoinRequest } from "@/lib/api/clinicJoin";
import { captureException } from "@/lib/observability/sentry";

/**
 * GESTÃO DE EQUIPE (WP-TEAM-2a) — só o admin da clínica.
 *
 * Dois blocos nesta etapa:
 *   1. PEDIDOS PENDENTES — a fila que o WP-JOIN-1 passou a produzir. Aprovar chama
 *      approve_join_request (que por sua vez chama promote_to_professional); rejeitar chama
 *      reject_join_request. Ambas já existiam, testadas e aplicadas — aqui só as expomos.
 *   2. EQUIPE ATUAL — reusa a MESMA query da tela de Disciplinas
 *      (useClinicProfessionalDisciplines), sem duplicar consulta.
 *
 * Desativar membro e "pacientes sem responsável" NÃO entram aqui: dependem do soft-delete de
 * professionals, que é o WP-TEAM-2b (mexe nos helpers de RLS e exige auditoria própria).
 *
 * Autorização: espelha o sinal REAL do banco (am_i_clinic_admin via useIsClinicAdmin) e é
 * FAIL-CLOSED enquanto carrega — mesmo padrão de DisciplinesAdminPage. O gate de verdade é a
 * RLS/RPC; esta tela só evita mostrar o que o banco recusaria.
 */
export function TeamAdminPage() {
  const navigate = useNavigate();
  const { data: me } = useCurrentProfessional();
  const clinicId = me?.clinicId ?? null;
  const { isClinicAdmin, isLoading: adminLoading } = useIsClinicAdmin(clinicId);
  const access = resolveTeamAccess({ isClinicAdmin, isLoading: adminLoading });

  const requests = usePendingJoinRequests(clinicId, access === "allowed");
  const team = useClinicProfessionalDisciplines(access === "allowed" ? clinicId : null);
  const disciplines = useDisciplinesList();

  const approve = useApproveJoinRequest(clinicId);
  const reject = useRejectJoinRequest(clinicId);

  const [error, setError] = useState<string | null>(null);
  const [approvedName, setApprovedName] = useState<string | null>(null);
  const [toReject, setToReject] = useState<ClinicJoinRequest | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  if (access === "loading") {
    return (
      <div className="space-y-6">
        <PageHeader title="Equipe" />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
            Verificando suas permissões…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (access === "denied") {
    return (
      <div className="space-y-6">
        <PageHeader title="Equipe" />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
            Apenas o administrador da clínica gerencia a equipe.
          </CardContent>
        </Card>
      </div>
    );
  }

  function handleError(err: unknown, scope: "approve" | "reject") {
    setError(decisionErrorMessage(err));
    // Erro esperado (não é admin / já respondida / sumiu) é UX, não incidente.
    // NUNCA anexar nome ou e-mail do solicitante: contexto lógico apenas.
    if (!isExpectedDecisionError(err)) captureException(err, { source: "team", scope });
  }

  function handleApprove(request: ClinicJoinRequest) {
    setError(null);
    setActingId(request.id);
    approve.mutate(request.id, {
      onSuccess: () => setApprovedName(requesterLabel(request)),
      onError: (err) => handleError(err, "approve"),
      onSettled: () => setActingId(null),
    });
  }

  function handleReject() {
    if (!toReject) return;
    const request = toReject;
    setError(null);
    setActingId(request.id);
    reject.mutate(request.id, {
      onError: (err) => handleError(err, "reject"),
      onSettled: () => {
        setActingId(null);
        setToReject(null);
      },
    });
  }

  const pending = requests.data ?? [];
  const summary = summarizeTeam(team.data ?? []);
  const allDisciplines = disciplines.data ?? [];
  const labelOf = (code: string) => allDisciplines.find((d) => d.code === code)?.label ?? code;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipe"
        description="Aprove quem pediu para entrar na clínica e acompanhe quem já faz parte."
      />

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {/* Confirmação da aprovação + o PRÓXIMO PASSO real: sem disciplina, o aprovado entra
          mas não escreve nada clínico. Levar direto para a tela que resolve isso. */}
      {approvedName ? (
        <div className="rounded-md border border-success/30 bg-success/5 px-4 py-3" role="status">
          <p className="text-sm font-medium text-foreground">
            {approvedName} agora faz parte da equipe.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Próximo passo: atribuir as disciplinas — sem elas, a pessoa entra no painel mas não
            registra nada clínico.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate("/configuracoes/disciplinas")}>
              Atribuir disciplinas
            </Button>
            <Button size="sm" variant="outline" onClick={() => setApprovedName(null)}>
              Agora não
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── BLOCO 1: PEDIDOS PENDENTES ─────────────────────────────────────────────── */}
      <section className="space-y-3" aria-labelledby="team-pending-heading">
        <div className="flex items-center gap-2">
          <h2 id="team-pending-heading" className="font-display text-lg font-semibold text-foreground">
            Pedidos pendentes
          </h2>
          {pending.length > 0 ? <Badge tone="primary">{pending.length}</Badge> : null}
        </div>

        <AsyncSection
          isLoading={requests.isLoading}
          isError={requests.isError}
          isEmpty={pending.length === 0}
          onRetry={() => void requests.refetch()}
          emptyIcon={Clock3}
          emptyTitle="Nenhum pedido aguardando"
          emptyDescription="Quando alguém usar o código de acesso da clínica, o pedido aparece aqui."
          emptyAction={
            <Button variant="outline" size="sm" onClick={() => navigate("/configuracoes")}>
              Ver o código de acesso
            </Button>
          }
        >
          <div className="space-y-3">
            {pending.map((r) => {
              const busy = actingId === r.id;
              const name = requesterLabel(r);
              return (
                <Card key={r.id}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback>{initials(name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground" title={name}>
                          {name}
                        </p>
                        {r.requesterEmail ? (
                          <p className="truncate text-xs text-muted-foreground" title={r.requesterEmail}>
                            {r.requesterEmail}
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          Solicitou {formatRelative(r.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button size="sm" onClick={() => handleApprove(r)} disabled={busy}>
                        {busy && approve.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Check className="h-4 w-4" aria-hidden />
                        )}
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setToReject(r)}
                        disabled={busy}
                      >
                        <X className="h-4 w-4" aria-hidden />
                        Rejeitar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </AsyncSection>
      </section>

      {/* ── BLOCO 2: EQUIPE ATUAL ──────────────────────────────────────────────────── */}
      <section className="space-y-3" aria-labelledby="team-current-heading">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="team-current-heading" className="font-display text-lg font-semibold text-foreground">
            Equipe atual
          </h2>
          {summary.total > 0 ? <Badge tone="muted">{summary.total}</Badge> : null}
          {summary.withoutDiscipline > 0 ? (
            <Badge tone="warning">
              {summary.withoutDiscipline} sem disciplina
            </Badge>
          ) : null}
        </div>

        <AsyncSection
          isLoading={team.isLoading}
          isError={team.isError}
          isEmpty={summary.total === 0}
          onRetry={() => void team.refetch()}
          emptyIcon={UserCog}
          emptyTitle="Nenhum profissional na clínica"
          emptyDescription="Compartilhe o código de acesso para que profissionais peçam para entrar."
          emptyAction={
            <Button variant="outline" size="sm" onClick={() => navigate("/configuracoes")}>
              Ver o código de acesso
            </Button>
          }
        >
          <div className="space-y-3">
            {(team.data ?? []).map((p) => {
              const isSelf = me?.id === p.professionalId;
              return (
                <Card key={p.professionalId}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback>{initials(p.fullName ?? "?")}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {shortName(p.fullName) ?? "Profissional"}
                          {isSelf ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.disciplines.length === 0
                            ? "Sem disciplina — não registra nada clínico"
                            : p.disciplines.map(labelOf).join(" · ")}
                        </p>
                      </div>
                    </div>
                    {p.disciplines.length === 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => navigate("/configuracoes/disciplinas")}
                      >
                        <UserCheck className="h-4 w-4" aria-hidden />
                        Atribuir disciplina
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </AsyncSection>

        <p className="text-xs text-muted-foreground">
          Para conceder ou remover disciplinas, use{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => navigate("/configuracoes/disciplinas")}
          >
            Disciplinas da equipe
          </button>
          .
        </p>
      </section>

      <AlertDialog open={Boolean(toReject)} onOpenChange={(open) => (!open ? setToReject(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejeitar esta solicitação?</AlertDialogTitle>
            <AlertDialogDescription>
              {toReject ? `${requesterLabel(toReject)} não entrará na equipe.` : ""} A pessoa continua
              podendo solicitar novamente com o código da clínica. Se o código vazou, gere um novo em
              Configurações.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reject.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleReject} disabled={reject.isPending}>
              {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Rejeitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
