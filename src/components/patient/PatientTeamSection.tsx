import { useState } from "react";
import { Loader2, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useDeactivatePatientLink,
  usePatientTeam,
  useReactivatePatientLink,
} from "@/hooks/usePatientTeam";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { formatDate, formatRelative, initials, professionalTypeLabel } from "@/lib/domain/format";
import {
  canManagePatientTeam,
  changedByLabel,
  isActiveLinkStatus,
  isExpectedLinkActionError,
  linkActionErrorMessage,
  linkStatusLabel,
  sortPatientTeam,
  summarizePatientTeam,
} from "@/lib/domain/patientTeam";
import type { PatientTeamMember } from "@/lib/api/patientTeam";
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

function MemberRow({
  member,
  canManage,
  busy,
  onDeactivate,
  onReactivate,
}: {
  member: PatientTeamMember;
  canManage: boolean;
  busy: boolean;
  onDeactivate: (m: PatientTeamMember) => void;
  onReactivate: (m: PatientTeamMember) => void;
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
                onClick={() => onDeactivate(member)}
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
                onClick={() => onReactivate(member)}
                aria-label={`Reativar vínculo de ${name}`}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <UserPlus className="h-4 w-4" aria-hidden />
                )}
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

  const [toDeactivate, setToDeactivate] = useState<PatientTeamMember | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const members = sortPatientTeam(team.data ?? []);
  const summary = summarizePatientTeam(team.data ?? []);

  function handleError(err: unknown, scope: "deactivate" | "reactivate") {
    setError(linkActionErrorMessage(err));
    // Erro esperado (não é admin / vínculo sumiu / parâmetro faltando) é UX, não incidente.
    // NUNCA anexar nome do profissional ou da paciente: contexto lógico apenas.
    if (!isExpectedLinkActionError(err)) captureException(err, { source: "patientTeam", scope });
  }

  function confirmDeactivate() {
    if (!toDeactivate) return;
    const member = toDeactivate;
    setError(null);
    setActingId(member.linkId);
    deactivate.mutate(
      {
        professionalId: member.professionalId,
        patientId,
        // Motivo é OPCIONAL: vazio vira null e a trilha simplesmente não carimba razão.
        reason: reason.trim() || null,
      },
      {
        onError: (err) => handleError(err, "deactivate"),
        onSettled: () => {
          setActingId(null);
          setToDeactivate(null);
          setReason("");
        },
      },
    );
  }

  function handleReactivate(member: PatientTeamMember) {
    setError(null);
    setActingId(member.linkId);
    reactivate.mutate(
      { professionalId: member.professionalId, patientId, reason: null },
      {
        onError: (err) => handleError(err, "reactivate"),
        onSettled: () => setActingId(null),
      },
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle>Equipe da paciente</CardTitle>
        {summary.active > 0 ? <Badge tone="success">{summary.active} ativo(s)</Badge> : null}
        {summary.inactive > 0 ? <Badge tone="muted">{summary.inactive} inativo(s)</Badge> : null}
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

        <AsyncSection
          isLoading={team.isLoading}
          isError={team.isError}
          isEmpty={members.length === 0}
          onRetry={() => void team.refetch()}
          emptyIcon={Users}
          emptyTitle="Nenhum profissional vinculado"
          emptyDescription="Quando um profissional for vinculado a esta paciente, ele aparece aqui."
        >
          <div className="space-y-3">
            {members.map((m) => (
              <MemberRow
                key={m.linkId}
                member={m}
                canManage={canManage}
                busy={actingId === m.linkId}
                onDeactivate={(x) => {
                  setError(null);
                  setReason("");
                  setToDeactivate(x);
                }}
                onReactivate={handleReactivate}
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

      <AlertDialog
        open={Boolean(toDeactivate)}
        onOpenChange={(open) => {
          if (!open) {
            setToDeactivate(null);
            setReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Desativar o vínculo de {toDeactivate?.fullName ?? "este profissional"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ao confirmar, esta pessoa perde o acesso aos dados da paciente e à conversa
              IMEDIATAMENTE. O histórico é preservado: a ficha, os registros e as mensagens já
              enviadas continuam no sistema, com autoria. Você pode reativar o vínculo depois.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="ppl-deactivate-reason">Motivo (opcional)</Label>
            <Textarea
              id="ppl-deactivate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: saiu da equipe, paciente trocou de responsável…"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Fica registrado na trilha de auditoria, junto com quem desativou e quando.
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivate.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate} disabled={deactivate.isPending}>
              {deactivate.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Desativar vínculo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
