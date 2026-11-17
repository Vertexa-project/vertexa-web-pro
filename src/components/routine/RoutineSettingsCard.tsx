// Configurações > "Rotina do paciente" (A4 + A5). Só o admin da clínica edita. Tudo nasce DESLIGADO.
import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";

import { PeriodWeekdayFields } from "./PeriodWeekdayFields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useClinicRoutineSettings, useSaveClinicRoutine } from "@/hooks/useRoutine";
import {
  DEFAULT_ROUTINE_SETTINGS, ROUTINE_ITEMS, type ClinicRoutineSettings, type MissionStepConfig, type RoutineItemKey, type RoutinePeriod,
} from "@/lib/domain/routine";

type Draft = Omit<ClinicRoutineSettings, "clinic_id">;

function Toggle({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <Button type="button" size="sm" variant={on ? "outline" : "default"} role="switch" aria-checked={on} aria-label={`${on ? "Desligar" : "Ligar"} ${label}`} disabled={disabled} onClick={onClick}>
      {on ? "Desligar" : "Ligar"}
    </Button>
  );
}

export function RoutineSettingsCard({ clinicId }: { clinicId: string | null }) {
  const q = useClinicRoutineSettings(clinicId);
  const save = useSaveClinicRoutine(clinicId);
  const [draft, setDraft] = useState<Draft>(DEFAULT_ROUTINE_SETTINGS);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (q.isSuccess) setDraft(q.data ? { ...DEFAULT_ROUTINE_SETTINGS, ...q.data } : DEFAULT_ROUTINE_SETTINGS);
  }, [q.isSuccess, q.data]);

  const setItem = (key: RoutineItemKey, v: { period: RoutinePeriod; weekday: number }) =>
    setDraft((d) => ({ ...d, [`${key}_period`]: v.period, [`${key}_weekday`]: v.weekday }) as Draft);
  const setStep = (key: string, patch: Partial<MissionStepConfig>) =>
    setDraft((d) => ({ ...d, mission_steps: d.mission_steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));

  const onSave = () => {
    setMsg(null);
    if (draft.mission_enabled && !draft.mission_steps.some((s) => s.enabled)) { setMsg({ tone: "err", text: "Deixe pelo menos um passo ligado na missão." }); return; }
    if (draft.mission_steps.some((s) => s.label.trim() === "")) { setMsg({ tone: "err", text: "Todo passo precisa de um texto." }); return; }
    save.mutate(draft, {
      onSuccess: () => setMsg({ tone: "ok", text: "Salvo." }),
      onError: () => setMsg({ tone: "err", text: "Não foi possível salvar. Tente de novo." }),
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden><ClipboardCheck className="h-5 w-5" /></span>
        <div className="space-y-1">
          <CardTitle className="text-base">Rotina do paciente</CardTitle>
          <CardDescription>Pede foto, peso e feedback no Início do app e mostra na ficha quem cumpriu. Vem desligado.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-0">
        {q.isLoading ? <Skeleton className="h-24 w-full" /> : q.isError ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar. <button type="button" className="underline" onClick={() => q.refetch()}>Tentar de novo</button></p>
        ) : (
          <>
            <section aria-label="Rotina" className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Rotina de acompanhamento</h3>
                  <Badge tone={draft.routine_enabled ? "success" : "muted"}>{draft.routine_enabled ? "Ligada" : "Desligada"}</Badge>
                </div>
                <Toggle on={draft.routine_enabled} label="a rotina" onClick={() => setDraft((d) => ({ ...d, routine_enabled: !d.routine_enabled }))} />
              </div>
              <p className="text-xs text-muted-foreground">Padrão sugerido: foto e peso uma vez por mês e feedback toda sexta. Cada paciente pode ter uma exceção na ficha.</p>
              <div className="divide-y divide-border">
                {ROUTINE_ITEMS.map((it) => (
                  <PeriodWeekdayFields key={it.key} id={`routine-${it.key}`} label={it.label}
                    period={draft[`${it.key}_period`]} weekday={draft[`${it.key}_weekday`]} onChange={(v) => setItem(it.key, v)} />
                ))}
              </div>
            </section>

            <section aria-label="Missão da 1ª semana" className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Missão da 1ª semana</h3>
                  <Badge tone={draft.mission_enabled ? "success" : "muted"}>{draft.mission_enabled ? "Ligada" : "Desligada"}</Badge>
                </div>
                <Toggle on={draft.mission_enabled} label="a missão da 1ª semana" onClick={() => setDraft((d) => ({ ...d, mission_enabled: !d.mission_enabled }))} />
              </div>
              <p className="text-xs text-muted-foreground">Checklist que o paciente novo cumpre antes da 1ª consulta. Vale para quem entrar depois de ligar; na ficha você pode iniciar para quem já é paciente.</p>
              <ul className="divide-y divide-border">
                {draft.mission_steps.map((s) => (
                  <li key={s.key} className="flex flex-wrap items-center gap-2 py-2">
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-[hsl(24_95%_53%)]" checked={s.enabled} aria-label={`Usar o passo ${s.label}`} onChange={(e) => setStep(s.key, { enabled: e.target.checked })} />
                    <Input className="h-9 min-w-0 flex-1 basis-48" value={s.label} maxLength={80} aria-label={`Texto do passo ${s.key}`} onChange={(e) => setStep(s.key, { label: e.target.value })} />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" className="h-4 w-4 accent-[hsl(24_95%_53%)]" checked={s.allow_skip} onChange={(e) => setStep(s.key, { allow_skip: e.target.checked })} />
                      pode dizer “não tenho”
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <label htmlFor="mission-days" className="text-sm text-muted-foreground">Prazo da missão</label>
                <select id="mission-days" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={draft.mission_days} onChange={(e) => setDraft((d) => ({ ...d, mission_days: Number(e.target.value) }))}>
                  {[3, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n} dias</option>)}
                </select>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={onSave} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Salvar rotina
              </Button>
              {msg ? <p role="status" className={`text-sm ${msg.tone === "ok" ? "text-success" : "text-destructive"}`}>{msg.text}</p> : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
