// Atendimento aberto: participantes, origem (venda/pacote), material (com custo para quem lê o estoque) e as ações — realizar, corrigir kit,
// trocar participantes, editar e cancelar. Quem pode agir é decidido pelo servidor (can_manage); aqui só se mostra o botão.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Field, FinTable, FormDialog } from "@/components/fin/FinUi";
import { ParticipantsFields } from "@/components/fin/ParticipantsFields";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useApptContext, useAppointment, useCancelAppointment, useSetParticipants } from "@/hooks/useFinAppointments";
import type { ApptMaterial } from "@/lib/api/finAppointments";
import { APPT_ROLE_LABEL, APPT_STATUS_LABEL, apptErrorMessage, apptTone, EMPTY_PARTICIPANTS, fromParticipants, toDrafts, validateParticipants, type ApptRole, type ParticipantsValue } from "@/lib/domain/finAppointments";
import { formatBRL } from "@/lib/domain/finance";
import { formatQty } from "@/lib/domain/stockMoves";
import { AppointmentFormDialog } from "@/pages/finance/appointments/AppointmentFormDialog";
import { KitDialog } from "@/pages/finance/appointments/KitDialog";
import { ReasonDialog } from "@/pages/finance/appointments/ReasonDialog";

const br = (iso: string | null) =>
  !iso ? "—" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");

function ParticipantsDialog({ apptId, clinicId, unitId, patientId, serviceId, initial, needReason, onClose }: {
  apptId: string; clinicId: string; unitId: string; patientId: string; serviceId: string; initial: ParticipantsValue; needReason: boolean; onClose: () => void;
}) {
  const ctx = useApptContext(clinicId, unitId, patientId, serviceId).data;
  const [parts, setParts] = useState<ParticipantsValue>(initial ?? EMPTY_PARTICIPANTS);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [partError, setPartError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const save = useSetParticipants();
  const roles = (ctx?.services.find((s) => s.id === serviceId)?.roles ?? ["responsavel"]) as ApptRole[];
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Trocar participantes" description="Os participantes são a base do repasse. Em atendimento já realizado, a troca fica registrada com o motivo." pending={save.isPending} error={error}
      onSubmit={() => {
        const pe = validateParticipants(toDrafts(parts), roles);
        setPartError(pe);
        const re = needReason && reason.trim().length < 3 ? "Informe o motivo da troca." : null;
        setReasonError(re);
        if (pe || re) return;
        setError(null);
        save.mutate({ id: apptId, participants: toDrafts(parts), reason: reason.trim() || undefined }, { onSuccess: onClose, onError: (e) => setError(apptErrorMessage(e)) });
      }}>
      <ParticipantsFields idPrefix="pt" value={parts} onChange={setParts} professionals={ctx?.professionals ?? []} allowedRoles={roles} error={partError} />
      <Field label={needReason ? "Motivo da troca" : "Motivo (opcional)"} htmlFor="pt-reason" error={reasonError}><Input id="pt-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
    </FormDialog>
  );
}

export function AppointmentDetail({ clinicId, apptId, onClose }: { clinicId: string; apptId: string; onClose: () => void }) {
  const q = useAppointment(apptId);
  const cancel = useCancelAppointment();
  const [modal, setModal] = useState<null | "complete" | "correct" | "participants" | "edit" | "cancel">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = q.data;
  const active = (a?.materials ?? []).filter((m) => m.status === "active");

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Atendimento{a ? ` — ${a.patient_name ?? "paciente"}` : ""}</DialogTitle>
          <DialogDescription>{a ? `${a.service_name} · ${a.unit_name} · ${br(a.performed_on)}` : "Carregando…"}</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-w-0 space-y-5">
          {q.isLoading ? <LoadingState /> : q.isError || !a ? <ErrorState onRetry={() => void q.refetch()} /> : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge tone={apptTone(a.status)}>{APPT_STATUS_LABEL[a.status]}</Badge>
                {a.has_shortfall ? <Badge tone="warning">Consumo sem saldo</Badge> : null}
                {a.package ? <span>Pacote <strong>{a.package.name}</strong> · {a.package.item_name} ({formatQty(a.package.qty_used)}/{formatQty(a.package.qty_total)})</span> : a.sale_description ? <span>Venda: <strong>{a.sale_description}</strong></span> : a.status === "done" ? <Badge tone="warning">Atendido sem venda</Badge> : <span className="text-muted-foreground">Sem venda ou pacote de origem</span>}
                {a.base_value_cents !== null ? <span>Valor-base <strong className="tabular-nums">{formatBRL(a.base_value_cents)}</strong></span> : null}
                {a.can_cost && a.material_cost_cents !== null ? <span>Material <strong className="tabular-nums">{formatBRL(a.material_cost_cents)}</strong>{a.material_estimated_cents ? <span className="text-muted-foreground"> (inclui {formatBRL(a.material_estimated_cents)} estimados)</span> : null}</span> : null}
              </div>
              {a.cancel_reason ? <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">Cancelado: {a.cancel_reason}</p> : null}
              {notice ? <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="status"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{notice}</p> : null}
              {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}

              <FinTable
                label="Participantes do atendimento" rows={a.participants} rowKey={(p) => `${p.professional_id}-${p.role}`}
                columns={[{ header: "Profissional", role: "title", cell: (p) => p.name }, { header: "Papel", role: "badge", cell: (p) => <Badge tone="info">{APPT_ROLE_LABEL[p.role]}</Badge> }]}
              />

              {active.length > 0 ? (
                <FinTable<ApptMaterial>
                  label="Material do atendimento" rows={active} rowKey={(m) => m.id}
                  columns={[
                    { header: "Item", role: "title", cell: (m) => m.item_name },
                    { header: "Origem", role: "badge", cell: (m) => <Badge tone={m.source === "kit" ? "info" : "muted"}>{m.source === "kit" ? "Kit" : "Adicionado"}</Badge> },
                    { header: "Quantidade", nowrap: true, cell: (m) => `${formatQty(m.qty_consumption)} ${m.consumption_unit}${m.planned_qty > 0 && m.planned_qty !== m.qty_consumption ? ` (kit: ${formatQty(m.planned_qty)})` : ""}` },
                    { header: "Sem saldo", nowrap: true, cell: (m) => (m.short_qty > 0 ? <Badge tone="warning">{formatQty(m.short_qty)} {m.stock_unit}</Badge> : "—") },
                    ...(a.can_cost ? [{ header: "Custo", nowrap: true, className: "tabular-nums", cell: (m: ApptMaterial) => formatBRL((m.cost_cents ?? 0) + (m.estimated_cents ?? 0)) }] : []),
                  ]}
                />
              ) : a.status === "done" ? <p className="text-sm text-muted-foreground">Nenhum material baixado neste atendimento.</p> : null}

              {a.can_manage && a.status !== "canceled" ? (
                <div className="flex flex-wrap gap-2">
                  {a.status === "open" ? <Button onClick={() => setModal("complete")}>Realizar atendimento</Button> : <Button variant="outline" onClick={() => setModal("correct")}>Corrigir kit</Button>}
                  {a.status === "open" ? <Button variant="outline" onClick={() => setModal("edit")}>Editar</Button> : null}
                  <Button variant="outline" onClick={() => setModal("participants")}>Trocar participantes</Button>
                  <Button variant="outline" onClick={() => setModal("cancel")}>Cancelar atendimento</Button>
                </div>
              ) : null}

              {modal === "complete" || modal === "correct" ? <KitDialog appt={a} mode={modal} onClose={() => setModal(null)} onDone={(r) => setNotice(r.hasShortfall ? "Parte do material não tinha saldo: ficou como «consumo sem saldo» e o gestor foi avisado. O atendimento foi salvo normalmente." : null)} /> : null}
              {modal === "edit" ? <AppointmentFormDialog clinicId={clinicId} editing={a} onClose={() => setModal(null)} /> : null}
              {modal === "participants" ? <ParticipantsDialog apptId={a.id} clinicId={clinicId} unitId={a.unit_id} patientId={a.patient_id} serviceId={a.service_id} initial={fromParticipants(a.participants)} needReason={a.status === "done"} onClose={() => setModal(null)} /> : null}
              {modal === "cancel" ? (
                <ReasonDialog title="Cancelar atendimento" label="Motivo do cancelamento" submitLabel="Cancelar atendimento" pending={cancel.isPending} error={error}
                  description={a.status === "done" ? "O estoque baixado volta, a sessão do pacote é devolvida e o repasse é avisado. Nada é apagado." : "O atendimento ainda não foi realizado: não há estoque a devolver."}
                  onClose={() => setModal(null)}
                  onSubmit={(reason) => { setError(null); cancel.mutate({ id: a.id, reason }, { onSuccess: () => setModal(null), onError: (e) => setError(apptErrorMessage(e)) }); }} />
              ) : null}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
