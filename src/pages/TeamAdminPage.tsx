import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  Clock3,
  Loader2,
  ShieldAlert,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useClinicProfessionalDisciplines, useDisciplinesList } from "@/hooks/useDisciplines";
import {
  useApproveJoinRequest,
  usePendingJoinRequests,
  useRejectJoinRequest,
} from "@/hooks/useClinicJoin";
import { useClinic } from "@/hooks/useClinic";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import {
  useDeactivateProfessional,
  useProfessionalStatusEvents,
  useReactivateProfessional,
} from "@/hooks/useProfessionalStatus";
import { formatDate, formatRelative, initials, shortName } from "@/lib/domain/format";
import {
  changedByLabel,
  isActiveProfessionalStatus,
  isExpectedMemberStatusError,
  latestStatusEventByProfessional,
  memberStatusErrorMessage,
  noActionExplanation,
  professionalStatusLabel,
  resolveMemberAction,
  sortTeamByStatus,
  summarizeTeamStatus,
} from "@/lib/domain/professionalStatus";
import {
  decisionErrorMessage,
  isExpectedDecisionError,
  requesterLabel,
  resolveTeamAccess,
  summarizeTeam,
} from "@/lib/domain/teamManagement";
import type { ClinicJoinRequest } from "@/lib/api/clinicJoin";
import type { ProfessionalWithDisciplines } from "@/lib/api/disciplines";
import { captureException } from "@/lib/observability/sentry";

type MemberStatusAction = "deactivate" | "reactivate";

/**
 * Texto das DUAS confirmações do estado do profissional. Ambas passam pelo MESMO AlertDialog —
 * muda só a cópia e qual mutação roda (mesmo padrão do PatientTeamSection; não existe um segundo
 * padrão de diálogo nesta casa).
 *
 * Cada descrição diz o efeito REAL, medido, sem eufemismo:
 *  · desativar — o corte é na CLÍNICA INTEIRA e imediato: todos os pacientes de uma vez, saída
 *    das conversas, e os vínculos viram histórico (a cascata roda no servidor, na mesma transação).
 *  · reativar  — ASSIMETRIA DELIBERADA do banco: devolve o poder de agir na clínica e NÃO devolve
 *    os pacientes. Cada vínculo é reconquistado um a um, na tela da paciente. A confirmação avisa
 *    em vez de esconder — quem reativa precisa saber que a pessoa volta sem carteira.
 */
const MEMBER_ACTION_COPY: Record<
  MemberStatusAction,
  { title: (name: string) => string; description: string; confirm: string; reasonHint: string }
> = {
  deactivate: {
    title: (name) => `Desativar o acesso de ${name}?`,
    description:
      "Ao confirmar, esta pessoa perde o acesso a TODOS os pacientes da clínica IMEDIATAMENTE, " +
      "sai das conversas em que participava, e os vínculos dela com as pacientes viram histórico. " +
      "O histórico é preservado: registros e mensagens já enviadas continuam no sistema, com " +
      "autoria. Você pode reativar depois.",
    confirm: "Desativar acesso",
    reasonHint: "Fica registrado na trilha de auditoria, junto com quem desativou e quando.",
  },
  reactivate: {
    title: (name) => `Reativar o acesso de ${name}?`,
    description:
      "Ao confirmar, esta pessoa volta a fazer parte da clínica e recupera o poder de agir nela. " +
      "⚠️ Isto NÃO devolve os pacientes: os vínculos que caíram na desativação continuam " +
      "inativos, e cada um é reconquistado um a um, na tela da paciente.",
    confirm: "Reativar acesso",
    reasonHint: "Fica registrado na trilha de auditoria, junto com quem reativou e quando.",
  },
};

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
 * WP-FRONT-2bii-A: o bloco 2 passa a mostrar o ESTADO de cada pessoa (Ativo/Inativo, e quando
 * inativo quem desativou/quando/por quê, da trilha `professional_status_events`) e a oferecer
 * Desativar/Reativar pelas RPCs do WP-TEAM-2b-ii. Deixou de ser "outro WP": o banco já tem tudo.
 *
 * Autorização: espelha o sinal REAL do banco (am_i_clinic_admin via useIsClinicAdmin) e é
 * FAIL-CLOSED enquanto carrega — mesmo padrão de DisciplinesAdminPage. O gate de verdade é a
 * RLS/RPC; esta tela só evita mostrar o que o banco recusaria.
 *
 * ⚠️ QUEM NÃO TEM BOTÃO, e por quê (a ordem é a MESMA das recusas do servidor):
 *   não-admin → a página inteira já é admin-only; e a linha, se renderizada, sai somente leitura
 *   o DONO    → 42501 OWNER_CANNOT_BE_DEACTIVATED; a tela mostra a razão: transfira a posse antes
 *   você      → 42501 SELF_DEACTIVATION_NOT_ALLOWED; a tela mostra a razão
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

  // Estado da equipe (WP-FRONT-2bii-A). A trilha é admin-only pela RLS — para o não-admin ela
  // voltaria VAZIA, e vazio aqui seria lido como "ninguém foi desativado". Por isso o `enabled`.
  const statusEvents = useProfessionalStatusEvents(clinicId, access === "allowed");
  // A clínica só é lida para saber QUEM É O DONO (owner_profile_id) — é a única forma de o
  // painel não oferecer um botão que o servidor recusa com OWNER_CANNOT_BE_DEACTIVATED.
  const clinic = useClinic(access === "allowed" ? clinicId : null);
  const deactivateMember = useDeactivateProfessional(clinicId);
  const reactivateMember = useReactivateProfessional(clinicId);

  const [error, setError] = useState<string | null>(null);
  const [approvedName, setApprovedName] = useState<string | null>(null);
  const [toReject, setToReject] = useState<ClinicJoinRequest | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  // UMA confirmação para as DUAS ações de estado, parametrizada pelo modo.
  const [pendingMember, setPendingMember] = useState<
    { member: ProfessionalWithDisciplines; mode: MemberStatusAction } | null
  >(null);
  const [memberReason, setMemberReason] = useState("");

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

  function handleMemberError(err: unknown, scope: MemberStatusAction) {
    setError(memberStatusErrorMessage(err));
    // Erro esperado (dono / si mesmo / não-admin / sumiu) é UX, não incidente. NUNCA anexar nome
    // ou e-mail: contexto lógico apenas.
    if (!isExpectedMemberStatusError(err)) captureException(err, { source: "team", scope });
  }

  function askMemberConfirmation(member: ProfessionalWithDisciplines, mode: MemberStatusAction) {
    setError(null);
    setMemberReason("");
    setPendingMember({ member, mode });
  }

  function closeMemberDialog() {
    setPendingMember(null);
    setMemberReason("");
  }

  function confirmMemberAction() {
    if (!pendingMember) return;
    const { member, mode } = pendingMember;
    const run = mode === "reactivate" ? reactivateMember : deactivateMember;
    setError(null);
    setActingId(member.professionalId);
    run.mutate(
      {
        professionalId: member.professionalId,
        // Motivo é OPCIONAL nos dois modos: vazio vira null e a trilha não carimba razão.
        reason: memberReason.trim() || null,
      },
      {
        onError: (err) => handleMemberError(err, mode),
        onSettled: () => {
          setActingId(null);
          closeMemberDialog();
        },
      },
    );
  }

  const pending = requests.data ?? [];
  const summary = summarizeTeam(team.data ?? []);
  const statusSummary = summarizeTeamStatus(team.data ?? []);
  const members = sortTeamByStatus(team.data ?? []);
  const lastEventOf = latestStatusEventByProfessional(statusEvents.data);
  const ownerProfileId = clinic.data?.owner_profile_id ?? null;
  const allDisciplines = disciplines.data ?? [];
  const labelOf = (code: string) => allDisciplines.find((d) => d.code === code)?.label ?? code;
  const memberMutation = pendingMember?.mode === "reactivate" ? reactivateMember : deactivateMember;
  const memberCopy = pendingMember ? MEMBER_ACTION_COPY[pendingMember.mode] : null;

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
          {statusSummary.inactive > 0 ? (
            <Badge tone="muted">{statusSummary.inactive} inativo(s)</Badge>
          ) : null}
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
            {members.map((p) => {
              const isSelf = me?.id === p.professionalId;
              const isOwner = Boolean(ownerProfileId && p.profileId && p.profileId === ownerProfileId);
              const active = isActiveProfessionalStatus(p.status);
              const name = shortName(p.fullName) ?? "Profissional";
              const busy = actingId === p.professionalId;
              // A MESMA ordem de recusa do servidor: admin → dono → si mesmo.
              const action = resolveMemberAction({
                isClinicAdmin,
                isAdminLoading: adminLoading,
                isSelf,
                isOwner,
                status: p.status,
              });
              const lastEvent = lastEventOf.get(p.professionalId);
              const explanation = action.kind === "none" ? noActionExplanation(action.reason) : null;

              return (
                <Card key={p.professionalId}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback>{initials(p.fullName ?? "?")}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium text-foreground">
                            {name}
                            {isSelf ? (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>
                            ) : null}
                          </p>
                          <Badge tone={active ? "success" : "muted"}>
                            {professionalStatusLabel(p.status)}
                          </Badge>
                          {isOwner ? <Badge tone="info">Dono</Badge> : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {p.disciplines.length === 0
                            ? "Sem disciplina — não registra nada clínico"
                            : p.disciplines.map(labelOf).join(" · ")}
                        </p>

                        {/* Quem desativou, quando e por quê — da trilha IMUTÁVEL
                            professional_status_events, gravada pelo SERVIDOR dentro da RPC.
                            Só faz sentido em quem está inativo. */}
                        {!active && lastEvent ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Desativado por {changedByLabel(lastEvent)} em{" "}
                            {formatDate(lastEvent.changedAt)}{" "}
                            <span className="text-muted-foreground/70">
                              ({formatRelative(lastEvent.changedAt)})
                            </span>
                            {lastEvent.reason ? ` · ${lastEvent.reason}` : ""}
                          </p>
                        ) : null}
                        {!active && !lastEvent && !statusEvents.isLoading ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Desativado — sem registro de quem ou quando.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <div className="flex flex-wrap gap-2">
                        {p.disciplines.length === 0 && active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate("/configuracoes/disciplinas")}
                          >
                            <UserCheck className="h-4 w-4" aria-hidden />
                            Atribuir disciplina
                          </Button>
                        ) : null}

                        {action.kind === "deactivate" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => askMemberConfirmation(p, "deactivate")}
                            aria-label={`Desativar acesso de ${name}`}
                          >
                            <UserMinus className="h-4 w-4" aria-hidden />
                            Desativar
                          </Button>
                        ) : null}

                        {action.kind === "reactivate" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => askMemberConfirmation(p, "reactivate")}
                            aria-label={`Reativar acesso de ${name}`}
                          >
                            <UserPlus className="h-4 w-4" aria-hidden />
                            Reativar
                          </Button>
                        ) : null}
                      </div>

                      {/* No lugar do botão, A RAZÃO — nunca um botão que o servidor recusaria. */}
                      {explanation ? (
                        <p className="max-w-xs text-xs text-muted-foreground sm:text-right">
                          {explanation}
                        </p>
                      ) : null}
                    </div>
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

      {/* MESMO AlertDialog para desativar E reativar o acesso — só a cópia e a mutação mudam. */}
      <AlertDialog
        open={Boolean(pendingMember)}
        onOpenChange={(open) => (!open ? closeMemberDialog() : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {memberCopy
                ? memberCopy.title(
                    shortName(pendingMember?.member.fullName ?? null) ?? "este profissional",
                  )
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>{memberCopy?.description ?? ""}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="member-status-reason">Motivo (opcional)</Label>
            <Textarea
              id="member-status-reason"
              value={memberReason}
              onChange={(e) => setMemberReason(e.target.value)}
              placeholder={
                pendingMember?.mode === "reactivate"
                  ? "Ex.: voltou da licença, retomou o atendimento na clínica…"
                  : "Ex.: saiu da clínica, encerrou o contrato…"
              }
              rows={3}
            />
            <p className="text-xs text-muted-foreground">{memberCopy?.reasonHint ?? ""}</p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={memberMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMemberAction} disabled={memberMutation.isPending}>
              {memberMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {memberCopy?.confirm ?? ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
