import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useSaveNutritionPlan } from "@/hooks/usePlanMutations";
import { useDisciplinePermissions } from "@/hooks/useDisciplines";
import { DISCIPLINE_REASON, isDisciplineDenied, writeDeniedMessage } from "@/lib/domain/disciplines";
import { captureException } from "@/lib/observability/sentry";
import type { SaveNutritionPlanInput } from "@/lib/api/planMutations";
import { MAX_ALTERNATIVES, kcalWarning, parseOptions } from "@/lib/domain/mealOptions";
import type { NutritionPlanFull, PatientDetail } from "@/types/db";

interface OptionForm {
  items: string;
  calories: string;
}
interface MealForm {
  time: string;
  name: string;
  items: string;
  calories: string;
  options: OptionForm[];
}
interface PlanForm {
  title: string;
  meals: MealForm[];
}

const emptyMeal = (): MealForm => ({ time: "", name: "", items: "", calories: "", options: [] });

function fromExisting(plan: NutritionPlanFull | null): PlanForm {
  if (!plan) return { title: "", meals: [emptyMeal()] };
  return {
    title: plan.title,
    meals: plan.meals.length
      ? plan.meals.map((m) => ({
          time: m.time ?? "",
          name: m.name ?? "",
          items: (m.items ?? []).join("\n"),
          calories: m.calories?.toString() ?? "",
          options: parseOptions(m.options).map((o) => ({ items: o.items.join("\n"), calories: o.calories?.toString() ?? "" })),
        }))
      : [emptyMeal()],
  };
}

interface Props {
  patient: PatientDetail;
  existing: NutritionPlanFull | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NutritionPlanEditor({ patient, existing, open, onOpenChange }: Props) {
  const [form, setForm] = useState<PlanForm>(() => fromExisting(existing));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveNutritionPlan(patient.id);
  const { perms } = useDisciplinePermissions();
  const canEdit = perms.canEditNutrition;

  useEffect(() => {
    if (open) {
      setForm(fromExisting(existing));
      setError(null);
    }
  }, [open, existing]);

  function patchMeal(i: number, patch: Partial<MealForm>) {
    setForm((f) => ({ ...f, meals: f.meals.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) }));
  }

  function patchOption(i: number, j: number, patch: Partial<OptionForm>) {
    patchMeal(i, { options: form.meals[i].options.map((o, k) => (k === j ? { ...o, ...patch } : o)) });
  }

  function handleSave() {
    if (!canEdit) {
      setError(DISCIPLINE_REASON.nutrition);
      return;
    }
    if (!form.title.trim()) {
      setError("Dê um título ao plano.");
      return;
    }
    const meals = form.meals.filter((m) => m.name.trim() || m.items.trim());
    if (meals.length === 0) {
      setError("Adicione ao menos uma refeição.");
      return;
    }
    const input: SaveNutritionPlanInput = {
      patientId: patient.id,
      professionalId: patient.professionals[0]?.id ?? null,
      title: form.title.trim(),
      meals: meals.map((m) => ({
        time: m.time.trim() || null,
        name: m.name.trim() || null,
        items: m.items.split("\n").map((s) => s.trim()).filter(Boolean),
        calories: m.calories ? Number(m.calories) : null,
        options: m.options
          .map((o) => ({ items: o.items.split("\n").map((x) => x.trim()).filter(Boolean), calories: o.calories ? Number(o.calories) : null }))
          .filter((o) => o.items.length > 0),
      })),
    };
    save.mutate(input, {
      onSuccess: () => onOpenChange(false),
      onError: (err) => {
        if (isDisciplineDenied(err)) {
          captureException(err, { source: "authz", scope: "nutrition" });
          setError(writeDeniedMessage(err, "nutrition"));
        } else {
          setError("Não foi possível salvar o plano. Tente novamente.");
        }
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Editar plano alimentar" : "Novo plano alimentar"}</DialogTitle>
          <DialogDescription>Um item por linha em cada refeição. O paciente verá no app.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="np-title">Título</Label>
            <Input
              id="np-title"
              autoFocus
              aria-invalid={Boolean(error) && !form.title.trim()}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Ex.: Plano 1600 kcal"
            />
          </div>

          {form.meals.map((m, i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Input
                  className="w-24"
                  value={m.time}
                  onChange={(e) => patchMeal(i, { time: e.target.value })}
                  placeholder="07:00"
                  aria-label="Horário"
                />
                <Input
                  value={m.name}
                  onChange={(e) => patchMeal(i, { name: e.target.value })}
                  placeholder="Nome da refeição (ex.: Café da manhã)"
                  aria-label="Nome da refeição"
                />
                <Input
                  type="number"
                  className="w-28"
                  value={m.calories}
                  onChange={(e) => patchMeal(i, { calories: e.target.value })}
                  placeholder="kcal"
                  aria-label="Calorias"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Remover refeição"
                  disabled={form.meals.length === 1}
                  onClick={() => setForm((f) => ({ ...f, meals: f.meals.filter((_, idx) => idx !== i) }))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                value={m.items}
                onChange={(e) => patchMeal(i, { items: e.target.value })}
                placeholder={"Itens (um por linha)\n2 ovos\n1 fatia de pão integral"}
                aria-label="Itens da refeição"
              />

              {m.options.map((o, j) => {
                const warn = kcalWarning(m.calories ? Number(m.calories) : null, o.calories ? Number(o.calories) : null);
                return (
                  <div key={j} className="space-y-2 rounded-md border border-dashed p-3" data-testid="meal-option">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-xs font-semibold text-muted-foreground">Opção {j + 2}</span>
                      <Input
                        type="number"
                        className="w-28"
                        value={o.calories}
                        onChange={(e) => patchOption(i, j, { calories: e.target.value })}
                        placeholder="kcal"
                        aria-label={`Calorias da opção ${j + 2}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remover opção ${j + 2}`}
                        onClick={() => patchMeal(i, { options: m.options.filter((_, k) => k !== j) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={o.items}
                      onChange={(e) => patchOption(i, j, { items: e.target.value })}
                      placeholder={"Itens da opção (um por linha)"}
                      aria-label={`Itens da opção ${j + 2}`}
                    />
                    {warn ? <p className="text-xs text-amber-600" role="note">{warn}</p> : null}
                  </div>
                );
              })}
              {m.options.length < MAX_ALTERNATIVES ? (
                <Button variant="ghost" size="sm" onClick={() => patchMeal(i, { options: [...m.options, { items: "", calories: "" }] })}>
                  <Plus className="h-4 w-4" />
                  Adicionar opção de troca
                </Button>
              ) : null}
            </div>
          ))}

          <Button variant="outline" onClick={() => setForm((f) => ({ ...f, meals: [...f.meals, emptyMeal()] }))}>
            <Plus className="h-4 w-4" />
            Adicionar refeição
          </Button>

          {!canEdit ? (
            <p className="text-sm text-muted-foreground" role="note">
              {DISCIPLINE_REASON.nutrition}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canEdit || save.isPending} aria-busy={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {save.isPending ? "Salvando…" : "Salvar plano"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
