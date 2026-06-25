import { useEffect, useRef, useState } from "react";
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
import { useCreatePatient } from "@/hooks/usePatients";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import type { CreatePatientInput } from "@/lib/api/patients";

// Form concentra TODOS os inputs do cadastro: identificação, objetivo/antropometria
// base e a anamnese/pré-consulta (o que antes era tela à parte). Tudo numérico entra
// como string e é convertido só no submit (campos vazios = null).
interface FormState {
  fullName: string;
  email: string;
  birthDate: string;
  sex: string;
  heightCm: string;
  goal: string;
  startWeight: string;
  targetWeight: string;
  // Anamnese / pré-consulta inicial (opcional → vira body_assessments).
  anamMethod: string;
  anamWeight: string;
  anamBodyFat: string;
  anamNotes: string;
}

const EMPTY: FormState = {
  fullName: "",
  email: "",
  birthDate: "",
  sex: "",
  heightCm: "",
  goal: "",
  startWeight: "",
  targetWeight: "",
  anamMethod: "",
  anamWeight: "",
  anamBodyFat: "",
  anamNotes: "",
};

const SEX_OPTIONS = [
  { value: "feminino", label: "Feminino" },
  { value: "masculino", label: "Masculino" },
  { value: "outro", label: "Outro" },
];

const METHOD_OPTIONS = [
  { value: "bioimpedancia", label: "Bioimpedância" },
  { value: "adipometro", label: "Adipômetro" },
  { value: "dexa", label: "DEXA" },
  { value: "manual", label: "Manual" },
];

function num(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function str(v: string): string | null {
  const t = v.trim();
  return t ? t : null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado com o id do paciente recém-criado (para navegar até a ficha). */
  onCreated: (patientId: string) => void;
}

export function PatientCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const create = useCreatePatient();
  // Profissional atuante (demo: Dra. Camila via env) → isolamento por clínica + vínculo.
  const { data: professional } = useCurrentProfessional();

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setError(null);
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit() {
    const fullName = form.fullName.trim();
    if (!fullName) {
      setError("Informe o nome do paciente.");
      nameRef.current?.focus();
      return;
    }
    const anamHasData =
      Boolean(str(form.anamMethod)) ||
      num(form.anamWeight) != null ||
      num(form.anamBodyFat) != null ||
      Boolean(str(form.anamNotes));

    const input: CreatePatientInput = {
      fullName,
      email: str(form.email),
      birthDate: str(form.birthDate),
      sex: str(form.sex),
      heightCm: num(form.heightCm),
      goal: str(form.goal),
      startWeight: num(form.startWeight),
      targetWeight: num(form.targetWeight),
      clinicId: professional?.clinicId ?? null,
      professionalId: professional?.id ?? null,
      anamnese: anamHasData
        ? {
            method: str(form.anamMethod),
            weight: num(form.anamWeight),
            bodyFatPct: num(form.anamBodyFat),
            notes: str(form.anamNotes),
          }
        : null,
    };

    setError(null);
    create.mutate(input, {
      onSuccess: (patientId) => {
        onOpenChange(false);
        onCreated(patientId);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastrar novo paciente</DialogTitle>
          <DialogDescription>
            Crie o paciente e preencha o que já tiver da pré-consulta. Tudo pode ser editado depois na ficha.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Identificação</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="np-name">
                  Nome completo <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="np-name"
                  ref={nameRef}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(error) && !form.fullName.trim()}
                  aria-describedby={error ? "np-form-error" : undefined}
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  placeholder="Ex.: Mariana Albuquerque"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-email">E-mail</Label>
                <Input
                  id="np-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="paciente@email.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-birth">Data de nascimento</Label>
                <Input
                  id="np-birth"
                  type="date"
                  value={form.birthDate}
                  onChange={(e) => set("birthDate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-sex">Sexo</Label>
                <Select value={form.sex} onValueChange={(v) => set("sex", v)}>
                  <SelectTrigger id="np-sex">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEX_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-height">Altura (cm)</Label>
                <Input
                  id="np-height"
                  inputMode="numeric"
                  value={form.heightCm}
                  onChange={(e) => set("heightCm", e.target.value)}
                  placeholder="168"
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Objetivo e metas</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="np-goal">Objetivo</Label>
                <Input
                  id="np-goal"
                  value={form.goal}
                  onChange={(e) => set("goal", e.target.value)}
                  placeholder="Ex.: Emagrecimento e ganho de massa"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-start">Peso inicial (kg)</Label>
                <Input
                  id="np-start"
                  inputMode="decimal"
                  value={form.startWeight}
                  onChange={(e) => set("startWeight", e.target.value)}
                  placeholder="72"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-target">Meta de peso (kg)</Label>
                <Input
                  id="np-target"
                  inputMode="decimal"
                  value={form.targetWeight}
                  onChange={(e) => set("targetWeight", e.target.value)}
                  placeholder="66"
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Anamnese / pré-consulta</h3>
              <p className="text-xs text-muted-foreground">
                Opcional. Se preenchida, vira a primeira avaliação corporal do paciente.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="np-method">Método</Label>
                <Select value={form.anamMethod} onValueChange={(v) => set("anamMethod", v)}>
                  <SelectTrigger id="np-method">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {METHOD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-aweight">Peso aferido (kg)</Label>
                <Input
                  id="np-aweight"
                  inputMode="decimal"
                  value={form.anamWeight}
                  onChange={(e) => set("anamWeight", e.target.value)}
                  placeholder="72"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-bf">% Gordura</Label>
                <Input
                  id="np-bf"
                  inputMode="decimal"
                  value={form.anamBodyFat}
                  onChange={(e) => set("anamBodyFat", e.target.value)}
                  placeholder="28"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="np-notes">Observações da anamnese</Label>
                <Textarea
                  id="np-notes"
                  rows={3}
                  value={form.anamNotes}
                  onChange={(e) => set("anamNotes", e.target.value)}
                  placeholder="Histórico, queixas, restrições, hábitos…"
                />
              </div>
            </div>
          </section>

          {error || create.isError ? (
            <p id="np-form-error" className="text-sm text-destructive" role="alert">
              {error ?? "Não foi possível cadastrar o paciente. Tente novamente."}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Cadastrando…
              </>
            ) : (
              "Cadastrar paciente"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
