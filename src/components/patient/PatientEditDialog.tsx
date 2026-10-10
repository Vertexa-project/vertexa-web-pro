import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { PatientDeleteSection } from "@/components/patient/PatientDeleteSection";
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
import { usePatientRegistrationAccess, useUpdatePatientRegistration } from "@/hooks/usePatients";
import {
  parseDecimalField,
  patientRegistrationErrorMessage,
  resolvePatientAccessUi,
  validatePatientEmail,
} from "@/lib/domain/patientRegistration";
import type { PatientDetail } from "@/types/db";

// Campos do cadastro que o schema atual realmente tem (nada inventado): nome, e-mail, nascimento,
// sexo, altura, objetivo, peso inicial, meta de peso e data de início. Números entram como string
// e só são convertidos no submit.
interface FormState {
  fullName: string;
  email: string;
  birthDate: string;
  sex: string;
  heightCm: string;
  goal: string;
  startWeight: string;
  targetWeight: string;
  startDate: string;
}

const SEX_OPTIONS = [
  { value: "feminino", label: "Feminino" },
  { value: "masculino", label: "Masculino" },
  { value: "outro", label: "Outro" },
];

const numToStr = (n: number | null | undefined) => (n == null ? "" : String(n));

function initialForm(patient: PatientDetail): FormState {
  return {
    fullName: patient.profile?.full_name ?? "",
    email: patient.profile?.email ?? "",
    birthDate: patient.birth_date ?? "",
    sex: patient.sex ?? "",
    heightCm: numToStr(patient.height_cm),
    goal: patient.goal ?? "",
    startWeight: numToStr(patient.start_weight),
    targetWeight: numToStr(patient.target_weight),
    startDate: patient.start_date ?? "",
  };
}

const todayIso = () => new Date().toISOString().slice(0, 10);

interface Props {
  patient: PatientDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado após salvar com sucesso (a ficha já foi invalidada/refeita pelo hook). */
  onSaved?: () => void;
  /** Chamado após excluir um cadastro não utilizado (lista já invalidada pelo hook). */
  onDeleted?: () => void;
}

export function PatientEditDialog({ patient, open, onOpenChange, onSaved, onDeleted }: Props) {
  const initial = useMemo(() => initialForm(patient), [patient]);
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const update = useUpdatePatientRegistration();
  const accessQ = usePatientRegistrationAccess(patient.id, open);

  const access = resolvePatientAccessUi({
    data: accessQ.data,
    isLoading: accessQ.isLoading,
    isError: accessQ.isError,
  });

  useEffect(() => {
    if (open) {
      setForm(initialForm(patient));
      setError(null);
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dirty = useMemo(
    () => (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== initial[k]),
    [form, initial],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit() {
    if (update.isPending) return; // double submit
    const fullName = form.fullName.trim();
    if (!fullName) {
      setError("Informe o nome do paciente.");
      nameRef.current?.focus();
      return;
    }

    // E-mail: editável só SEM conta de acesso. Com conta (ou estado desconhecido) reenvia o valor
    // atual do cadastro — o servidor trata como no-op e nunca altera a identidade de login.
    let email: string | null;
    if (access.kind === "no-account") {
      const v = validatePatientEmail(form.email, Boolean(initial.email.trim()));
      if (!v.ok) {
        setError(v.message);
        return;
      }
      email = v.value;
    } else {
      email = initial.email.trim() || null;
    }

    const height = parseDecimalField(form.heightCm);
    const startW = parseDecimalField(form.startWeight);
    const targetW = parseDecimalField(form.targetWeight);
    if (!height.ok) return setError("Altura inválida. Use apenas números.");
    if (!startW.ok) return setError("Peso inicial inválido. Use apenas números.");
    if (!targetW.ok) return setError("Meta de peso inválida. Use apenas números.");

    const today = todayIso();
    if (form.birthDate && form.birthDate > today) return setError("A data de nascimento não pode ser futura.");
    if (form.startDate && form.startDate > today) return setError("A data de início não pode ser futura.");
    if (form.birthDate && form.startDate && form.startDate < form.birthDate) {
      return setError("A data de início não pode ser anterior ao nascimento.");
    }

    setError(null);
    update.mutate(
      {
        patientId: patient.id,
        fullName,
        email,
        birthDate: form.birthDate || null,
        sex: form.sex || null,
        heightCm: height.value,
        goal: form.goal.trim() || null,
        startWeight: startW.value,
        targetWeight: targetW.value,
        startDate: form.startDate || null,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          onSaved?.();
        },
      },
    );
  }

  const emailLocked = access.kind === "linked";
  const emailHidden = access.kind === "linked" && !access.emailTrusted;
  const shownError = error ?? (update.isError ? patientRegistrationErrorMessage(update.error) : null);

  return (
    <Dialog open={open} onOpenChange={(o) => (update.isPending || deleting ? undefined : onOpenChange(o))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cadastro</DialogTitle>
          <DialogDescription>
            Atualize os dados cadastrais do paciente. O histórico clínico não é alterado.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Identificação</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pe-name">
                  Nome completo <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="pe-name"
                  ref={nameRef}
                  required
                  aria-required="true"
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pe-email">{emailLocked ? "E-mail de acesso" : "E-mail do paciente"}</Label>
                  {access.kind === "no-account" ? (
                    <span className="text-xs text-muted-foreground">Acesso ainda não ativado</span>
                  ) : null}
                  {access.kind === "linked" ? (
                    <span className="text-xs text-muted-foreground">Conta de acesso vinculada</span>
                  ) : null}
                </div>
                <Input
                  id="pe-email"
                  type="email"
                  value={emailHidden ? "" : form.email}
                  onChange={(e) => set("email", e.target.value)}
                  readOnly={emailLocked}
                  disabled={access.kind === "loading"}
                  aria-readonly={emailLocked}
                  placeholder={
                    emailHidden ? "E-mail de acesso não confirmado pelo cadastro" : "paciente@email.com"
                  }
                  aria-describedby="pe-email-help"
                />
                <p id="pe-email-help" className="text-xs text-muted-foreground">
                  {access.kind === "no-account"
                    ? "Esse e-mail será usado para localizar o cadastro quando o paciente acessar o Vertexa pela primeira vez."
                    : access.kind === "linked"
                      ? "Este paciente já possui uma conta de acesso vinculada. A identidade de login não pode ser alterada diretamente pelo cadastro."
                      : "Verificando o acesso do paciente…"}
                  {emailHidden && accessQ.data
                    ? " O e-mail do cadastro pode ser diferente do e-mail da conta de acesso."
                    : ""}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pe-birth">Data de nascimento</Label>
                <Input
                  id="pe-birth"
                  type="date"
                  value={form.birthDate}
                  onChange={(e) => set("birthDate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pe-sex">Sexo</Label>
                <Select value={form.sex} onValueChange={(v) => set("sex", v)}>
                  <SelectTrigger id="pe-sex">
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
                <Label htmlFor="pe-height">Altura (cm)</Label>
                <Input
                  id="pe-height"
                  inputMode="decimal"
                  value={form.heightCm}
                  onChange={(e) => set("heightCm", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pe-startdate">Data de início</Label>
                <Input
                  id="pe-startdate"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Objetivo e metas</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pe-goal">Objetivo</Label>
                <Input id="pe-goal" value={form.goal} onChange={(e) => set("goal", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pe-startw">Peso inicial (kg)</Label>
                <Input
                  id="pe-startw"
                  inputMode="decimal"
                  value={form.startWeight}
                  onChange={(e) => set("startWeight", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pe-targetw">Meta de peso (kg)</Label>
                <Input
                  id="pe-targetw"
                  inputMode="decimal"
                  value={form.targetWeight}
                  onChange={(e) => set("targetWeight", e.target.value)}
                />
              </div>
            </div>
          </section>

          {shownError ? (
            <p id="pe-form-error" className="text-sm text-destructive" role="alert">
              {shownError}
            </p>
          ) : null}

          {onDeleted ? (
            <PatientDeleteSection
              patientId={patient.id}
              patientName={patient.profile?.full_name ?? "este paciente"}
              enabled={open}
              onPendingChange={setDeleting}
              onDeleted={() => {
                onOpenChange(false);
                onDeleted();
              }}
            />
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={update.isPending || !dirty || access.kind === "loading"}>
            {update.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              "Salvar alterações"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
