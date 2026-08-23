import { useMemo, useState } from "react";
import { Loader2, Plus, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useClinicProfessionalDisciplines, useDisciplinesList } from "@/hooks/useDisciplines";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import {
  useAssignPatientProfessional,
  useDeactivatePatientLink,
  usePatientTeam,
  useReactivatePatientLink,
} from "@/hooks/usePatientTeam";
import type { PatientTeamMember } from "@/lib/api/patientTeam";
import { formatDate, formatRelative, initials, professionalTypeLabel } from "@/lib/domain/format";
import {
  assignActionErrorMessage,
  canManagePatientTeam,
  changedByLabel,
  eligibleProfessionalsForAssign,
  formatAssignCandidateQualification,
  isActiveLinkStatus,
  isExpectedLinkActionError,
  linkActionErrorMessage,
  linkStatusLabel,
  sortPatientTeam,
  summarizePatientTeam,
} from "@/lib/domain/patientTeam";
import { captureException } from "@/lib/observability/sentry";

/**
 * EQUIPE DA PACIENTE (WP-2bi-UI) — a ÚNICA superfície do produto que mostra vínculo INATIVO, e
 * mostra COM o status visível. Todo o resto (listagem, header) só enxerga ativos.
 *
 * Autorização: espelha o sinal REAL do banco (`am_i_clinic_admin` via useIsClinicAdmin) e é
 * FAIL-CLOSED. Para quem não é admin a seção continua aparecendo, mas SOMENTE LEITURA — sem
 * nenhum botão. O gate de verdade são as RPCs (42501); esta tela só evita oferecer uma ação que
 * o servidor recusaria.
 *
 * O paciente não vê nada disto: é tela do painel profissional.
 */
interface PatientTeamSectionProps {
  patientId: string;
  /** patients.clinic_id — a clínica cujo admin pode gerenciar estes vínculos. */
  clinicId: string | null;
}

type LinkAction = "deactivate" | "reactivate";

/**
 * Texto das DUAS confirmações. Ambas passam pelo MESMO AlertDialog — o que muda é só a cópia e
 * qual mutação roda. Cada descrição diz o efeito REAL, sem eufemismo:
 *
 *  · desativar  — o corte é imediato nos dois canais (dado e conversa), e o histórico fica.
 *  · reativar   — WP-05A1: acesso e roster voltam na hora se o canal já existir.
 */
const ACTION_COPY: Record<
  LinkAction,
  { title: (name: string) => string; description: string; confirm: string; reasonHint: string }
> = {
  deactivate: {
    title: (name) => `Desativar o vínculo de ${name}?`,
    description:
      "Ao confirmar, esta pessoa perde o acesso aos dados da paciente e à conversa IMEDIATAMENTE. " +
      "O histórico é preservado: a ficha, os registros e as mensagens já enviadas continuam no " +
      "sistema, com autoria. Você pode reativar o vínculo depois.",
    confirm: "Desativar vínculo",
    reasonHint: "Fica registrado na trilha de auditoria, junto com quem desativou e quando.",
  },
  reactivate: {
    title: (name) => `Reativar o vínculo de ${name}?`,
    description:
      "Ao confirmar, esta pessoa volta a ter acesso aos dados da paciente e à conversa " +
      "IMEDIATAMENTE. O histórico permanece. Se a conversa já existir, ela volta à lista de " +
      "participantes na hora — o banco não cria canal só por reativar.",
    confirm: "Reativar vínculo",
    reasonHint: "Fica registrado na trilha de auditoria, junto com quem reativou e quando.",
  },
};

function MemberRow({
  member,
  canManage,
  busy,
  onAct,
}: {
  member: PatientTeamMember;
  canManage: boolean;
  busy: boolean;
  /** Abre a confirmação — nenhuma das duas ações dispara direto da linha. */
  onAct: (m: PatientTeamMember, mode: LinkAction) => void;
}) {
  const active = isActiveLinkStatus(member.status);
  const name = member.fullName ?? "Profissional";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium text-foreground" title={name}>
                {name}
              </p>
              <Badge tone={active ? "success" : "muted"}>{linkStatusLabel(member.status)}</Badge>
              {member.isExternal ? <Badge tone="info">Externo</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">{professionalTypeLabel(member.type)}</p>

            {/* Quem desativou e quando — as colunas de carimbo, preenchidas pelo SERVIDOR
                dentro da RPC. Só fazem sentido no vínculo inativo. */}
            {!active ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Desativado por {changedByLabel(member)}
                {member.statusChangedAt ? (
                  <>
                    {" "}
                    em {formatDate(member.statusChangedAt)}{" "}
                    <span className="text-muted-foreground/70">
                      ({formatRelative(member.statusChangedAt)})
                    </span>
                  </>
                ) : null}
                {member.statusReason ? ` · ${member.statusReason}` : ""}
              </p>
            ) : null}
          </div>
        </div>

        {canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {active ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onAct(member, "deactivate")}
                aria-label={`Desativar vínculo de ${name}`}
              >
                <UserMinus className="h-4 w-4" aria-hidden />
                Desativar
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onAct(member, "reactivate")}
                aria-label={`Reativar vínculo de ${name}`}
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Reativar
              </Button>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PatientTeamSection({ patientId, clinicId }: PatientTeamSectionProps) {
  const team = usePatientTeam(patientId);
  const { isClinicAdmin, isLoading: adminLoading } = useIsClinicAdmin(clinicId);
  const canManage = canManagePatientTeam({ isClinicAdmin, isLoading: adminLoading });

  const deactivate = useDeactivatePatientLink(patientId);
  const reactivate = useReactivatePatientLink(patientId);
  const assign = useAssignPatientProfessional(patientId, clinicId);
  const clinicTeam = useClinicProfessionalDisciplines(canManage ? clinicId : null);
  const catalog = useDisciplinesList();

  // UMA confirmação para desativar/reativar. O dialog de ATRIBUIR é outro: escolhe alguém da
  // clínica e chama assign_patient_professional — não mistura com o motivo das duas ações.
  const [pending, setPending] = useState<{ member: PatientTeamMember; mode: LinkAction } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const members = sortPatientTeam(team.data ?? []);
  const summary = summarizePatientTeam(team.data ?? []);
  const labelByCode = useMemo(
    () => new Map((catalog.data ?? []).map((d) => [d.code, d.label])),
    [catalog.data],
  );
  const eligible = useMemo(
    () => eligibleProfessionalsForAssign(clinicTeam.data ?? [], team.data ?? []),
    [clinicTeam.data, team.data],
  );

  const mutation = pending?.mode === "reactivate" ? reactivate : deactivate;
  const copy = pending ? ACTION_COPY[pending.mode] : null;

  function handleError(err: unknown, scope: LinkAction) {
    setError(linkActionErrorMessage(err));
    // Erro esperado (não é admin / vínculo sumiu / parâmetro faltando) é UX, não incidente.
    // NUNCA anexar nome do profissional ou da paciente: contexto lógico apenas.
    if (!isExpectedLinkActionError(err)) captureException(err, { source: "patientTeam", scope });
  }

  function askConfirmation(member: PatientTeamMember, mode: LinkAction) {
    setError(null);
    setSuccess(null);
    setReason("");
    setPending({ member, mode });
  }

  function closeDialog() {
    setPending(null);
    setReason("");
  }

  function openAssign() {
    setError(null);
    setSuccess(null);
    setAssignError(null);
    setSelectedProfessionalId(null);
    setAssignOpen(true);
  }

  function closeAssign() {
    if (assign.isPending) return;
    setAssignOpen(false);
    setSelectedProfessionalId(null);
    setAssignError(null);
  }

  function confirmAssign() {
    if (!selectedProfessionalId || assign.isPending) return;
    setAssignError(null);
    assign.mutate(
      { patientId, professionalId: selectedProfessionalId },
      {
        onSuccess: () => {
          setSuccess("Profissional adicionado à equipe.");
          setAssignOpen(false);
          setSelectedProfessionalId(null);
          setAssignError(null);
        },
        onError: (err) => {
          setAssignError(assignActionErrorMessage(err));
          if (!isExpectedLinkActionError(err)) {
            captureException(err, { source: "patientTeam", scope: "assign" });
          }
        },
      },
    );
  }

  function confirmAction() {
    if (!pending) return;
    const { member, mode } = pending;
    const run = mode === "reactivate" ? reactivate : deactivate;
    setError(null);
    setActingId(member.linkId);
    run.mutate(
      {
        professionalId: member.professionalId,
        patientId,
        // Motivo é OPCIONAL nos dois modos: vazio vira null e a trilha não carimba razão.
        reason: reason.trim() || null,
      },
      {
        onError: (err) => handleError(err, mode),
        onSettled: () => {
          setActingId(null);
          closeDialog();
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle>Equipe da paciente</CardTitle>
        {summary.active > 0 ? <Badge tone="success">{summary.active} ativo(s)</Badge> : null}
        {summary.inactive > 0 ? <Badge tone="muted">{summary.inactive} inativo(s)</Badge> : null}
        {canManage ? (
          <Button size="sm" className="ml-auto" onClick={openAssign}>
            <Plus className="h-4 w-4" aria-hidden />
            Adicionar profissional
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? (
          <p
            className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {success ? (
          <p
            className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <AsyncSection
          isLoading={team.isLoading}
          isError={team.isError}
          isEmpty={members.length === 0}
          onRetry={() => void team.refetch()}
          emptyIcon={Users}
          emptyTitle="Nenhum profissional vinculado"
          emptyDescription={
            canManage
              ? "Adicione profissionais da clínica à equipe desta paciente."
              : "Quando um profissional for vinculado a esta paciente, ele aparece aqui."
          }
          emptyAction={
            canManage ? (
              <Button size="sm" onClick={openAssign}>
                <Plus className="h-4 w-4" aria-hidden />
                Adicionar profissional
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-3">
            {members.map((m) => (
              <MemberRow
                key={m.linkId}
                member={m}
                canManage={canManage}
                busy={actingId === m.linkId}
                onAct={askConfirmation}
              />
            ))}
          </div>
        </AsyncSection>

        {/* Honestidade sobre o que a lista É para quem não administra: a policy ppl_select devolve
            ao profissional comum APENAS o próprio vínculo — não a equipe inteira. Dizer isso evita
            que alguém leia "sou o único" quando na verdade é "só posso ver o meu". */}
        {!canManage && !team.isLoading && members.length > 0 ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Somente leitura. Apenas o administrador da clínica altera vínculos — e você enxerga aqui
            só os vínculos que tem permissão de ver.
          </p>
        ) : null}
      </CardContent>

      <Dialog open={assignOpen} onOpenChange={(open) => (!open ? closeAssign() : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar profissional</DialogTitle>
            <DialogDescription>
              Selecione um profissional da clínica para adicionar à equipe deste paciente.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {assignError ? (
              <p
                className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                {assignError}
              </p>
            ) : null}
            {eligible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Não há profissionais elegíveis nesta clínica agora.
              </p>
            ) : (
              <ul className="space-y-2">
                {eligible.map((p) => {
                  const name = p.fullName ?? "Profissional";
                  const selected = selectedProfessionalId === p.professionalId;
                  return (
                    <li key={p.professionalId}>
                      <button
                        type="button"
                        disabled={assign.isPending}
                        aria-pressed={selected}
                        aria-label={name}
                        onClick={() => setSelectedProfessionalId(p.professionalId)}
                        className={
                          "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors " +
                          (selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/50")
                        }
                      >
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback>{initials(name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatAssignCandidateQualification(p, labelByCode)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={closeAssign} disabled={assign.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={confirmAssign}
              disabled={!selectedProfessionalId || assign.isPending}
            >
              {assign.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MESMO AlertDialog para desativar E reativar — só a cópia e a mutação mudam. */}
      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => (!open ? closeDialog() : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {copy ? copy.title(pending?.member.fullName ?? "este profissional") : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>{copy?.description ?? ""}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="ppl-link-action-reason">Motivo (opcional)</Label>
            <Textarea
              id="ppl-link-action-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                pending?.mode === "reactivate"
                  ? "Ex.: voltou a acompanhar a paciente, retorno de férias…"
                  : "Ex.: saiu da equipe, paciente trocou de responsável…"
              }
              rows={3}
            />
            <p className="text-xs text-muted-foreground">{copy?.reasonHint ?? ""}</p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAction} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {copy?.confirm ?? ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
