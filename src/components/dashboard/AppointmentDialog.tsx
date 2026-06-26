import { useEffect, useState } from "react";
import { addHours, format, parseISO } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useClinicProfessionals } from "@/hooks/useCurrentProfessional";
import { useCreateAppointment, useDeleteAppointment, useUpdateAppointment } from "@/hooks/useAppointments";
import { useListPatients } from "@/hooks/usePatients";
import type { AppointmentInput } from "@/lib/api/appointments";
import { professionalTypeLabel } from "@/lib/domain/format";
import { STATUS_META, TYPE_META } from "@/lib/domain/agenda";
import type { AppointmentStatus, AppointmentType, AppointmentView } from "@/types/db";

const NONE = "none";

function isoToParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = parseISO(iso);
  return { date: format(d, "yyyy-MM-dd"), time: format(d, "HH:mm") };
}

function combine(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function todayISODate(): string {
  return format(new Date(), "yyyy-MM-dd");
}

interface FormState {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  patientId: string;
  professionalId: string;
  notes: string;
  type: AppointmentType;
  status: AppointmentStatus;
}

function fromExisting(
  appt: AppointmentView | null,
  defaultProfessionalId: string | null,
  initialStart: Date | null,
): FormState {
  if (!appt) {
    // Criar: se veio de um slot do calendário, pré-preenche data/hora dele (+1h de término).
    const base = initialStart;
    return {
      title: "",
      date: base ? format(base, "yyyy-MM-dd") : todayISODate(),
      startTime: base ? format(base, "HH:mm") : "09:00",
      endTime: base ? format(addHours(base, 1), "HH:mm") : "10:00",
      patientId: NONE,
      professionalId: defaultProfessionalId ?? NONE,
      notes: "",
      type: "consulta",
      status: "confirmado",
    };
  }
  const start = isoToParts(appt.starts_at);
  const end = isoToParts(appt.ends_at);
  return {
    title: appt.title,
    date: start.date || todayISODate(),
    startTime: start.time || "09:00",
    endTime: end.time || "",
    patientId: appt.patient_id ?? NONE,
    professionalId: appt.professional_id ?? NONE,
    notes: appt.notes ?? "",
    type: appt.type,
    status: appt.status,
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clinicId: string;
  /** Compromisso em edição; null = criar. */
  existing: AppointmentView | null;
  /** Profissional padrão ao criar (o logado). */
  defaultProfessionalId: string | null;
  /** Início pré-selecionado ao criar a partir de um slot do calendário (Sessão 12). */
  initialStart?: Date | null;
}

export function AppointmentDialog({
  open,
  onOpenChange,
  clinicId,
  existing,
  defaultProfessionalId,
  initialStart = null,
}: Props) {
  const [form, setForm] = useState<FormState>(() => fromExisting(existing, defaultProfessionalId, initialStart));
  const [error, setError] = useState<string | null>(null);
  const create = useCreateAppointment(clinicId);
  const update = useUpdateAppointment(clinicId);
  const del = useDeleteAppointment(clinicId);
  const { data: patients } = useListPatients();
  const { data: professionals } = useClinicProfessionals(clinicId);

  const isEdit = Boolean(existing);
  const pending = create.isPending || update.isPending || del.isPending;
  const failed = create.isError || update.isError || del.isError;

  useEffect(() => {
    if (open) {
      setForm(fromExisting(existing, defaultProfessionalId, initialStart));
      setError(null);
      create.reset();
      update.reset();
      del.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing, defaultProfessionalId, initialStart]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit() {
    const title = form.title.trim();
    if (!title) {
      setError("Dê um título ao compromisso.");
      return;
    }
    const startsAt = combine(form.date, form.startTime);
    if (!startsAt) {
      setError("Informe data e hora de início.");
      return;
    }
    const endsAt = combine(form.date, form.endTime);
    if (endsAt && endsAt < startsAt) {
      setError("O término deve ser depois do início.");
      return;
    }
    const input: AppointmentInput = {
      clinicId,
      title,
      startsAt,
      endsAt,
      patientId: form.patientId === NONE ? null : form.patientId,
      professionalId: form.professionalId === NONE ? null : form.professionalId,
      notes: form.notes.trim() || null,
      type: form.type,
      status: form.status,
    };
    setError(null);
    const onSuccess = () => onOpenChange(false);
    if (existing) update.mutate({ id: existing.id, input }, { onSuccess });
    else create.mutate(input, { onSuccess });
  }

  function handleDelete() {
    if (!existing) return;
    if (window.confirm(`Excluir "${existing.title}"?`)) {
      del.mutate(existing.id, { onSuccess: () => onOpenChange(false) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar compromisso" : "Novo compromisso"}</DialogTitle>
          <DialogDescription>Agenda interna da clínica. Tudo pode ser editado depois.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ap-title">
              Título <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ap-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Ex.: Consulta de retorno"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ap-date">Data</Label>
              <Input id="ap-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap-start">Início</Label>
              <Input id="ap-start" type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap-end">Término</Label>
              <Input id="ap-end" type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ap-patient">Paciente</Label>
              <Select value={form.patientId} onValueChange={(v) => set("patientId", v)}>
                <SelectTrigger id="ap-patient">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem paciente</SelectItem>
                  {(patients ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.profile?.full_name ?? "Sem nome"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap-prof">Profissional</Label>
              <Select value={form.professionalId} onValueChange={(v) => set("professionalId", v)}>
                <SelectTrigger id="ap-prof">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem profissional</SelectItem>
                  {(professionals ?? []).map((pr) => (
                    <SelectItem key={pr.id} value={pr.id}>
                      {pr.fullName ?? "Profissional"} · {professionalTypeLabel(pr.type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ap-type">Tipo</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v as AppointmentType)}>
                <SelectTrigger id="ap-type">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_META) as AppointmentType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_META[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap-status">Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as AppointmentStatus)}>
                <SelectTrigger id="ap-status">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_META) as AppointmentStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ap-notes">Observações</Label>
            <Textarea
              id="ap-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Pauta, preparo, lembretes…"
            />
          </div>

          {error || failed ? (
            <p className="text-sm text-destructive" role="alert">
              {error ?? "Não foi possível salvar o compromisso. Tente novamente."}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          {isEdit ? (
            <Button
              variant="outline"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={handleDelete}
              disabled={pending}
            >
              {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : isEdit ? (
              "Salvar alterações"
            ) : (
              "Criar compromisso"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
