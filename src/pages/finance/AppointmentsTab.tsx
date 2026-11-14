// Financeiro › Atendimentos (Entrega 4): lista com filtros, «Novo atendimento», detalhe (participantes, kit, custo do material) e a fila «atendido sem venda».
// Gestor/Financeiro/Admin veem todos; o profissional vê só aqueles em que participa (o servidor filtra).
import { useState } from "react";
import { Plus, Stethoscope } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { CheckField, ExportButtons, FinTable } from "@/components/fin/FinUi";
import { FilterBar } from "@/components/fin/FinFilters";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useAppointments } from "@/hooks/useFinAppointments";
import type { ApptRow } from "@/lib/api/finAppointments";
import { canManageAppointments, canSeeAppointments, canStartAppointment } from "@/lib/domain/finAccess";
import { APPT_ROLE_LABEL, APPT_STATUS_LABEL, apptTone, type ApptStatus } from "@/lib/domain/finAppointments";
import { formatBRL } from "@/lib/domain/finance";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";
import { AppointmentDetail } from "@/pages/finance/appointments/AppointmentDetail";
import { AppointmentFormDialog } from "@/pages/finance/appointments/AppointmentFormDialog";

const br = (iso: string | null) =>
  !iso ? "—" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");
const statuses = (Object.keys(APPT_STATUS_LABEL) as ApptStatus[]).map((value) => ({ value, label: APPT_STATUS_LABEL[value] }));
const partsText = (r: ApptRow) => r.participants.map((p) => `${p.name} (${APPT_ROLE_LABEL[p.role].toLowerCase()})`).join(", ");
const origin = (r: ApptRow) => (r.package_name ? `Pacote ${r.package_name}` : r.sale_id ? "Venda" : r.without_sale ? "Sem venda" : "—");

export function AppointmentsTab() {
  const { clinicId, access } = useFinContext();
  const [params, setParams] = useSearchParams();
  const [from, setFrom] = useState(params.get("de") ?? "");
  const [to, setTo] = useState(params.get("ate") ?? "");
  const [unitId, setUnitId] = useState(params.get("unidade") ?? "");
  const [status, setStatus] = useState(params.get("situacao") ?? "");
  const [onlyWithoutSale, setOnlyWithoutSale] = useState(params.get("semVenda") === "1");
  const [onlyShortfall, setOnlyShortfall] = useState(false);
  const [newOpen, setNewOpen] = useState(params.get("novo") === "1");
  const [openId, setOpenId] = useState<string | null>(null);
  const canRead = canSeeAppointments(access);
  const canStart = canStartAppointment(access);
  const manager = canManageAppointments(access);
  const units = useUnits(clinicId, canRead && manager).data ?? [];
  const q = useAppointments(clinicId, { unitId, status: status as ApptStatus | "", from, to, onlyWithoutSale, onlyShortfall }, canRead);
  const initialPatient = params.get("paciente") ? { id: params.get("paciente") as string, name: params.get("nome") ?? "Paciente" } : null;
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const rows = q.data ?? [];
  const seesCost = rows.some((r) => r.material_cost_cents !== null);
  const closeNew = (open: boolean) => { setNewOpen(open); if (!open && params.has("novo")) setParams({}, { replace: true }); };
  const columns: ExportColumn<ApptRow>[] = [
    { header: "Data", value: (r) => br(r.performed_on) }, { header: "Unidade", value: (r) => r.unit_name }, { header: "Paciente", value: (r) => r.patient_name },
    { header: "Serviço", value: (r) => r.service_name }, { header: "Participantes", value: partsText }, { header: "Origem", value: origin },
    { header: "Valor-base (R$)", value: (r) => r.base_value_cents, kind: "money" },
    ...(seesCost ? [{ header: "Material (R$)", value: (r: ApptRow) => r.material_cost_cents, kind: "money" as const }] : []),
    { header: "Consumo sem saldo", value: (r) => (r.has_shortfall ? "Sim" : "Não") }, { header: "Situação", value: (r) => APPT_STATUS_LABEL[r.status] },
  ];

  return (
    <div className="min-w-0 space-y-4">
      {!manager ? <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="note">{access.can.appt_read ? "Você consulta os atendimentos da clínica." : "Você vê só os atendimentos em que participa."}</p> : null}
      <FilterBar idPrefix="appt" from={from} to={to} onFrom={setFrom} onTo={setTo} units={manager ? units : undefined} unitId={unitId} onUnit={setUnitId} statuses={statuses} status={status} onStatus={setStatus} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <CheckField id="appt-nosale" label="Só atendidos sem venda" checked={onlyWithoutSale} onChange={setOnlyWithoutSale} />
        <CheckField id="appt-short" label="Só com consumo sem saldo" checked={onlyShortfall} onChange={setOnlyShortfall} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExportButtons columns={columns} rows={rows} filename="atendimentos" sheetName="Atendimentos" />
        {canStart ? <Button onClick={() => setNewOpen(true)}><Plus aria-hidden /> Novo atendimento</Button> : null}
      </div>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Nenhum atendimento no período" description="Registre o atendimento com quem participou; ao realizá-lo, o kit baixa do estoque e o custo do material fica gravado."
          action={canStart ? <Button onClick={() => setNewOpen(true)}>Novo atendimento</Button> : undefined} />
      ) : (
        <FinTable<ApptRow>
          label="Atendimentos" rows={rows} rowKey={(r) => r.id}
          columns={[
            { header: "Paciente", role: "title", cell: (r) => r.patient_name ?? "—" },
            { header: "Situação", role: "badge", cell: (r) => <Badge tone={apptTone(r.status)}>{APPT_STATUS_LABEL[r.status]}</Badge> },
            ...(rows.some((r) => r.has_shortfall) ? [{ header: "Estoque", role: "badge" as const, cell: (r: ApptRow) => (r.has_shortfall ? <Badge tone="warning">Consumo sem saldo</Badge> : null) }] : []),
            { header: "Data", nowrap: true, cell: (r) => br(r.performed_on) },
            { header: "Serviço", cell: (r) => r.service_name },
            { header: "Participantes", wide: true, cell: (r) => partsText(r) },
            { header: "Origem", cell: (r) => (r.without_sale ? <Badge tone="warning">Sem venda</Badge> : origin(r)) },
            ...(seesCost ? [{ header: "Material", nowrap: true, className: "tabular-nums", cell: (r: ApptRow) => (r.material_cost_cents === null ? "—" : `${formatBRL(r.material_cost_cents)}${r.material_estimated_cents ? "*" : ""}`) }] : []),
            { header: "Ações", role: "action", cell: (r) => <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)} aria-label={`Abrir atendimento de ${r.patient_name ?? "paciente"}`}>Abrir</Button> },
          ]}
        />
      )}
      {seesCost && rows.some((r) => r.material_estimated_cents) ? <p className="text-xs text-muted-foreground">* inclui valor estimado de material sem saldo, até a regularização.</p> : null}
      {newOpen && canStart ? <AppointmentFormDialog key={initialPatient?.id ?? "n"} clinicId={clinicId} initialPatient={initialPatient} onClose={() => closeNew(false)} onSaved={(id) => setOpenId(id)} /> : null}
      {openId ? <AppointmentDetail clinicId={clinicId} apptId={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
