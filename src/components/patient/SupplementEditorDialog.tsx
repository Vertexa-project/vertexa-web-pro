import { useEffect, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateSupplement, useUpdateSupplement } from "@/hooks/useSupplements";
import { useDisciplinePermissions } from "@/hooks/useDisciplines";
import { DISCIPLINE_REASON, isDisciplineDenied, writeDeniedMessage } from "@/lib/domain/disciplines";
import { findCatalogItem, SUPPLEMENT_CATALOG } from "@/lib/domain/supplementCatalog";
import {
  BRAND_MAX,
  emptySupplementForm,
  KIND_LABEL,
  NOTES_MAX,
  reminderToInput,
  validateSupplement,
  type SupplementForm,
  type SupplementKind,
} from "@/lib/domain/supplementForm";
import { captureException } from "@/lib/observability/sentry";
import type { Supplement } from "@/types/db";

interface Props {
  patientId: string;
  existing: Supplement | null; // null = criar
  /** Tipo ao criar (ao editar vem do registro; é imutável). */
  kind: SupplementKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NO_CATALOG = "none";

/** Cria/edita UM suplemento ou medicamento: nome, dose, momento, marca indicada, observação e lembrete. */
export function SupplementEditorDialog({ patientId, existing, kind, open, onOpenChange }: Props) {
  const [form, setForm] = useState<SupplementForm>(emptySupplementForm());
  const [error, setError] = useState<string | null>(null);

  const create = useCreateSupplement(patientId);
  const update = useUpdateSupplement(patientId);
  const pending = create.isPending || update.isPending;
  const { perms } = useDisciplinePermissions();
  const effectiveKind: SupplementKind = existing?.kind ?? kind;
  const surface = effectiveKind === "medication" ? "medications" : "supplements";
  const canEdit = effectiveKind === "medication" ? perms.canEditMedications : perms.canEditSupplements;
  const label = KIND_LABEL[effectiveKind];

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      existing
        ? {
            name: existing.name,
            dose: existing.dose ?? "",
            timeLabel: existing.time_label ?? "",
            brand: existing.brand ?? "",
            notes: existing.notes ?? "",
            reminderTime: reminderToInput(existing.reminder_time),
          }
        : emptySupplementForm(),
    );
  }, [open, existing]);

  const set = (patch: Partial<SupplementForm>) => setForm((f) => ({ ...f, ...patch }));

  function pickFromCatalog(id: string) {
    const item = findCatalogItem(id);
    if (item) set({ name: item.name, dose: item.dose, timeLabel: item.moment });
  }

  function handleSave() {
    if (!canEdit) return setError(DISCIPLINE_REASON[surface]);
    const r = validateSupplement(form, effectiveKind);
    if (!r.ok) return setError(r.error);
    const onSuccess = () => onOpenChange(false);
    const onError = (err: unknown) => {
      if (isDisciplineDenied(err)) {
        captureException(err, { source: "authz", scope: surface });
        setError(writeDeniedMessage(err, surface));
      } else {
        setError("Não foi possível salvar. Tente novamente.");
      }
    };
    if (existing) update.mutate({ id: existing.id, kind: effectiveKind, ...r.value }, { onSuccess, onError });
    else create.mutate({ patientId, kind: effectiveKind, ...r.value }, { onSuccess, onError });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? `Editar ${label.toLowerCase()}` : `Novo ${label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>
            O paciente vê esta lista no app e recebe o lembrete no horário; o “tomado” é registrado por ele.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {effectiveKind === "supplement" && !existing ? (
            <div className="space-y-2">
              <Label htmlFor="sup-catalog">Escolher da lista (opcional)</Label>
              <Select value={NO_CATALOG} onValueChange={(v) => (v === NO_CATALOG ? undefined : pickFromCatalog(v))}>
                <SelectTrigger id="sup-catalog">
                  <SelectValue placeholder="Suplementos comuns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATALOG}>Suplementos comuns…</SelectItem>
                  {SUPPLEMENT_CATALOG.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Preenche nome, dose e momento. Tudo continua editável.</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="sup-name">Nome</Label>
            <Input
              id="sup-name"
              autoFocus
              value={form.name}
              aria-invalid={Boolean(error) && !form.name.trim()}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={effectiveKind === "medication" ? "Ex.: Losartana" : "Ex.: Creatina"}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sup-dose">Dose</Label>
              <Input id="sup-dose" value={form.dose} onChange={(e) => set({ dose: e.target.value })} placeholder="Ex.: 5 g" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-time">Momento</Label>
              <Input id="sup-time" value={form.timeLabel} onChange={(e) => set({ timeLabel: e.target.value })} placeholder="Ex.: Pós-treino" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sup-brand">Marca indicada</Label>
              <Input id="sup-brand" maxLength={BRAND_MAX} value={form.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="Opcional" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-reminder">Lembrete às</Label>
              <Input id="sup-reminder" type="time" value={form.reminderTime} onChange={(e) => set({ reminderTime: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sup-notes">Observação para o paciente</Label>
            <textarea
              id="sup-notes"
              rows={2}
              maxLength={NOTES_MAX}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Ex.: tomar com água, longe das refeições"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {!canEdit ? (
            <p className="text-sm text-muted-foreground" role="note">
              {DISCIPLINE_REASON[surface]}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canEdit || pending} aria-busy={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {pending ? "Salvando…" : existing ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
