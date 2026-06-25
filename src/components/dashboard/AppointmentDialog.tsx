import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";

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
import { useCreateAppointment, useUpdateAppointment } from "@/hooks/useAppointments";
import { useListPatients } from "@/hooks/usePatients";
import type { AppointmentInput } from "@/lib/api/appointments";
import { professionalTypeLabel } from "@/lib/domain/format";
import type { AppointmentView } from "@/types/db";

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
}

function fromExisting(appt: AppointmentView | null, defaultProfessionalId: string | null): FormState {
  if (!appt) {
    return {
      title: "",
      date: todayISODate(),
      startTime: "09:00",
      endTime: "10:00",
      patientId: NONE,
      professionalId: defaultProfessionalId ?? NONE,
      notes: "",
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
}

export function AppointmentDialog({ open, onOpenChange, clinicId, existing, defaultProfessionalId }: Props) {
  const [form, setForm] = useState<FormState>(() => fromExisting(existing, defaultProfessionalId));
  const [error, setError] = useState<string | null>(null);
  const create = useCreateAppointment(clinicId);
  const update = useUpdateAppointment(clinicId);
  const { data: patients } = useListPatients();
  const { data: professionals } = useClinicProfessionals(clinicId);

  const isEdit = Boolean(existing);
  const pending = create.isPending || update.isPending;
  const failed = create.isError || update.isError;

  useEffect(() => {
    if (open) {
      setForm(fromExisting(existing, defaultProfessionalId));
      setError(null);
      create.reset();
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing, defaultProfessionalId]);

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
    };
    setError(null);
    const onSuccess = () => onOpenChange(false);
    if (existing) update.mutate({ id: existing.id, input }, { onSuccess });
    else create.mutate(input, { onSuccess });
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
