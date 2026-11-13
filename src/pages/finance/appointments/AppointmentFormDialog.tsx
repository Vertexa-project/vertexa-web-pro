// Novo atendimento / editar atendimento aberto (escopo-v1 §4.4): paciente, serviço, data, unidade, venda ou pacote de origem e participantes por papel.
// Quem é Gestor/Admin registra de qualquer um; o profissional registra o PRÓPRIO (o servidor confere) e só de paciente a que tem acesso.
import { useEffect, useMemo, useState } from "react";

import { Field, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { ParticipantsFields } from "@/components/fin/ParticipantsFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApptContext, useApptPatients, useSaveAppointment } from "@/hooks/useFinAppointments";
import type { ApptDetail } from "@/lib/api/finAppointments";
import { apptErrorMessage, EMPTY_PARTICIPANTS, fromParticipants, toDrafts, validateParticipants, type ApptRole, type ParticipantsValue } from "@/lib/domain/finAppointments";
import { formatBRL } from "@/lib/domain/finance";
import { todayIsoBR } from "@/lib/domain/stockMoves";

const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export function AppointmentFormDialog({ clinicId, editing, initialPatient, onClose, onSaved }: {
  clinicId: string; editing?: ApptDetail | null; initialPatient?: { id: string; name: string } | null; onClose: () => void; onSaved?: (id: string) => void;
}) {
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(editing ? { id: editing.patient_id, name: editing.patient_name ?? "Paciente" } : initialPatient ?? null);
  const [search, setSearch] = useState("");
  const found = useApptPatients(clinicId, search.trim(), !patient).data ?? [];
  const [unitId, setUnitId] = useState(editing?.unit_id ?? "");
  const [serviceId, setServiceId] = useState(editing?.service_id ?? "");
  const [performedOn, setPerformedOn] = useState(editing?.performed_on ?? todayIsoBR());
  const [link, setLink] = useState(editing?.sale_item_id ? `sale:${editing.sale_item_id}` : editing?.patient_package_item_id ? `pkg:${editing.patient_package_item_id}` : "none");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [parts, setParts] = useState<ParticipantsValue>(editing ? fromParticipants(editing.participants) : EMPTY_PARTICIPANTS);
  const [error, setError] = useState<string | null>(null);
  const [partError, setPartError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const ctx = useApptContext(clinicId, unitId || null, patient?.id ?? null, serviceId || null);
  const c = ctx.data;
  const save = useSaveAppointment(clinicId);

  const unit = unitId || c?.units.find((u) => u.is_primary)?.id || c?.units[0]?.id || "";
  const service = c?.services.find((s) => s.id === serviceId) ?? null;
  const allowedRoles = (service?.roles ?? ["responsavel"]) as ApptRole[];
  // o profissional que não é gestor entra sozinho como responsável (só pode registrar o PRÓPRIO atendimento)
  useEffect(() => {
    if (c && !c.can_manage && c.my_professional_id && !editing && !parts.responsavel && !parts.executor) setParts((p) => ({ ...p, responsavel: c.my_professional_id as string }));
  }, [c, editing, parts.responsavel, parts.executor]);
  // trocar o serviço limpa o vínculo e os papéis que o novo serviço não prevê
  const changeService = (id: string) => {
    setServiceId(id); setLink("none");
    const next = c?.services.find((s) => s.id === id)?.roles ?? ["responsavel"];
    setParts((p) => ({ ...p, executor: next.includes("executor") ? p.executor : "", auxiliares: next.includes("auxiliar") ? p.auxiliares : [] }));
  };

  const linkOptions = useMemo(() => {
    const sales = (c?.sale_items ?? []).map((s) => ({ value: `sale:${s.sale_item_id}`, label: `Venda de ${br(s.sold_on)} — ${s.description}${s.net_cents !== null ? ` (${formatBRL(s.net_cents)})` : ""}` }));
    const pkgs = (c?.packages ?? []).map((p) => ({ value: `pkg:${p.patient_package_item_id}`, label: `Pacote ${p.name} — restam ${p.remaining} (vence ${br(p.expires_on)})` }));
    const own = editing && link !== "none" && ![...sales, ...pkgs].some((o) => o.value === link) ? [{ value: link, label: editing.package ? `Pacote ${editing.package.name}` : editing.sale_description ?? "Origem atual" }] : [];
    return [...own, ...sales, ...pkgs];
  }, [c, editing, link]);

  function submit() {
    const errs: Record<string, string> = {};
    if (!patient) errs.patient = "Escolha o paciente.";
    if (!unit) errs.unit = "Escolha a unidade.";
    if (!serviceId) errs.service = "Escolha o serviço.";
    if (!performedOn) errs.date = "Informe a data.";
    setFieldErrors(errs);
    const pe = validateParticipants(toDrafts(parts), allowedRoles);
    setPartError(pe);
    if (Object.keys(errs).length > 0 || pe) { setError(null); return; }
    setError(null);
    save.mutate({
      id: editing?.id ?? null, unitId: unit, patientId: (patient as { id: string }).id, serviceId, performedOn,
      saleItemId: link.startsWith("sale:") ? link.slice(5) : null, patientPackageItemId: link.startsWith("pkg:") ? link.slice(4) : null,
      notes: notes.trim() || undefined, participants: toDrafts(parts),
    }, { onSuccess: (id) => { onClose(); onSaved?.(id as string); }, onError: (e) => setError(apptErrorMessage(e)) });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={editing ? "Editar atendimento" : "Novo atendimento"} wide submitLabel={editing ? "Salvar" : "Registrar atendimento"}
      description="Registre quem atende e de qual venda ou pacote ele vem. O kit é confirmado ao realizar o atendimento." onSubmit={submit} pending={save.isPending} error={error}>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Paciente" htmlFor="ap-patient" error={fieldErrors.patient} className="sm:col-span-2">
          {patient ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium">{patient.name}</span>
              {!editing ? <Button type="button" variant="ghost" size="sm" onClick={() => { setPatient(null); setLink("none"); }}>Trocar</Button> : null}
            </div>
          ) : (
            <div className="space-y-1">
              <Input id="ap-patient" placeholder="Buscar pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} />
              <ul className="max-h-40 overflow-auto rounded-md border" aria-label="Pacientes encontrados">
                {found.length === 0 ? <li className="px-3 py-2 text-xs text-muted-foreground">Nenhum paciente encontrado.</li> : found.map((p) => (
                  <li key={p.patient_id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setPatient({ id: p.patient_id, name: p.full_name })}>{p.full_name}</button></li>
                ))}
              </ul>
            </div>
          )}
        </Field>
        <Field label="Unidade" htmlFor="ap-unit" error={fieldErrors.unit}>
          <NativeSelect id="ap-unit" value={unit} disabled={Boolean(editing)} onChange={(e) => setUnitId(e.target.value)}>
            {(c?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Data do atendimento" htmlFor="ap-date" error={fieldErrors.date}>
          <Input id="ap-date" type="date" value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} />
        </Field>
        <Field label="Serviço" htmlFor="ap-service" error={fieldErrors.service} className="sm:col-span-2">
          <NativeSelect id="ap-service" value={serviceId} onChange={(e) => changeService(e.target.value)}>
            <option value="">Selecione…</option>
            {(c?.services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Origem (venda ou pacote)" htmlFor="ap-link" className="sm:col-span-2"
          hint={patient && serviceId && linkOptions.length === 0 ? "Este paciente não tem venda nem pacote com saldo para este serviço. O atendimento entra na fila «atendido sem venda»." : "Sem origem, o atendimento fica na fila «atendido sem venda»."}>
          <NativeSelect id="ap-link" value={link} onChange={(e) => setLink(e.target.value)} disabled={!patient || !serviceId}>
            <option value="none">Sem venda (avulso)</option>
            {linkOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <ParticipantsFields idPrefix="ap" value={parts} onChange={setParts} professionals={c?.professionals ?? []} allowedRoles={allowedRoles} error={partError} />
      <Field label="Observação (opcional)" htmlFor="ap-notes"><Input id="ap-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
    </FormDialog>
  );
}
