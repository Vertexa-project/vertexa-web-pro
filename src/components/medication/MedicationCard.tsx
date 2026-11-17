// Cartão "Medicação" da ficha do paciente (A3): tratamento, dose, dia da aplicação, histórico de doses, aplicações e entregas.
// Lista (não tabela) para caber em 390 px sem rolar de lado. Quem não é médico/nutricionista vê, mas não edita.
import { useState } from "react";
import { Pencil, Pill, Plus, Trash2 } from "lucide-react";

import { ApplicationDialog, DeliveryDialog, DoseDialog, TreatmentDialog } from "./MedicationDialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDisciplinePermissions } from "@/hooks/useDisciplines";
import { useMedication, useMedMutations } from "@/hooks/useMedication";
import { dateBR, formatMg, medErrorMessage, PLACE_LABEL, stateText, weekdayLabel, type MedState, type MedTreatment } from "@/lib/domain/medication";

type Dlg = { kind: "treatment"; t: MedTreatment | null } | { kind: "dose" | "application" | "delivery"; t: MedTreatment } | null;
const SHOW = 5;

function History({ title, empty, children, count }: { title: string; empty: string; children: React.ReactNode[]; count: number }) {
  const [all, setAll] = useState(false);
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {count === 0 ? <p className="mt-1 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="mt-1 divide-y">{all ? children : children.slice(0, SHOW)}</ul>
      )}
      {count > SHOW ? <button type="button" className="mt-1 text-xs underline text-primary-ink" onClick={() => setAll(!all)}>{all ? "Mostrar menos" : `Ver todos (${count})`}</button> : null}
    </div>
  );
}

export function MedicationCard({ patientId }: { patientId: string }) {
  const q = useMedication(patientId);
  const { perms } = useDisciplinePermissions();
  const canEdit = perms.canEditMedications || perms.canEditNutrition;
  const m = useMedMutations(patientId);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [error, setError] = useState<string | null>(null);
  const data = q.data;
  const active = (data?.treatments ?? []).filter((t) => t.status === "active");
  const ended = (data?.treatments ?? []).filter((t) => t.status === "ended");
  const close = (o: boolean) => { if (!o) setDlg(null); };

  const run = (fn: () => Promise<unknown>) => { setError(null); fn().catch((e) => setError(medErrorMessage(e))); };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Pill className="h-4 w-4 text-muted-foreground" aria-hidden />
          Medicação
        </CardTitle>
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "treatment", t: null })}>
            <Plus className="h-4 w-4" aria-hidden />
            Novo tratamento
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {q.isLoading ? <Skeleton className="h-16 w-full" /> : q.isError ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar. <button type="button" className="underline" onClick={() => q.refetch()}>Tentar de novo</button></p>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum tratamento cadastrado.{canEdit ? " Cadastre a medicação, a dose e o dia da aplicação." : " Só médico ou nutricionista que acompanha o paciente cadastra."}
          </p>
        ) : active.map((t) => {
          const st = data?.states[t.id] as MedState | undefined;
          const tag = st ? stateText(st) : null;
          const doses = (data?.doses ?? []).filter((d) => d.treatment_id === t.id);
          const apps = (data?.applications ?? []).filter((a) => a.treatment_id === t.id);
          const dels = (data?.deliveries ?? []).filter((d) => d.treatment_id === t.id);
          return (
            <section key={t.id} aria-label={`Tratamento ${t.medication}`} className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-foreground">{t.medication} · {formatMg(t.dose_mg)}</p>
                  <p className="text-xs text-muted-foreground">
                    {weekdayLabel(t.weekday)} · {PLACE_LABEL[t.applied_where]} · desde {dateBR(t.started_on)}
                  </p>
                  {t.notes ? <p className="mt-1 break-words text-xs text-muted-foreground">{t.notes}</p> : null}
                </div>
                {tag ? <Badge tone={tag.tone}>{tag.label}</Badge> : null}
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setDlg({ kind: "application", t })}>Registrar aplicação</Button>
                  <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "delivery", t })}>Registrar entrega</Button>
                  <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "dose", t })}>Ajustar dose</Button>
                  <Button size="sm" variant="ghost" aria-label={`Editar tratamento ${t.medication}`} onClick={() => setDlg({ kind: "treatment", t })}><Pencil className="h-4 w-4" aria-hidden />Editar</Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={m.end.isPending} onClick={() => run(() => m.end.mutateAsync(t.id))}>Encerrar</Button>
                </div>
              ) : null}
              <History title="Histórico de doses" empty="Sem ajustes." count={doses.length}>
                {doses.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5 text-sm">
                    <span className="font-medium text-foreground">{formatMg(d.dose_mg)}</span>
                    <span className="text-xs text-muted-foreground">desde {dateBR(d.effective_on)}{d.note ? ` · ${d.note}` : ""}</span>
                  </li>
                ))}
              </History>
              <History title="Aplicações" empty="Nenhuma aplicação registrada." count={apps.length}>
                {apps.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 py-1.5 text-sm">
                    <div className="min-w-0">
                      <p className="text-foreground"><span className="font-medium">{dateBR(a.applied_on)}</span> · {formatMg(a.dose_mg)}</p>
                      <p className="break-words text-xs text-muted-foreground">
                        {PLACE_LABEL[a.place]} · {a.source === "patient" ? "registrada pelo paciente" : `por ${a.applied_by_name ?? "equipe"}`}{a.stock_item_id ? " · baixa no estoque" : ""}{a.note ? ` · ${a.note}` : ""}
                      </p>
                    </div>
                    {canEdit ? <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Apagar aplicação de ${dateBR(a.applied_on)}`} disabled={m.remove.isPending} onClick={() => run(() => m.remove.mutateAsync({ kind: "application", id: a.id }))}><Trash2 className="h-4 w-4" aria-hidden /></Button> : null}
                  </li>
                ))}
              </History>
              <History title="Entregas" empty="Nenhuma entrega registrada." count={dels.length}>
                {dels.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-2 py-1.5 text-sm">
                    <div className="min-w-0">
                      <p className="text-foreground"><span className="font-medium">{dateBR(d.delivered_on)}</span> · {d.quantity} {d.quantity === 1 ? "caneta/dose" : "canetas/doses"}</p>
                      <p className="break-words text-xs text-muted-foreground">{d.stock_item_id ? "baixa no estoque" : "sem baixa de estoque"}{d.note ? ` · ${d.note}` : ""}</p>
                    </div>
                    {canEdit ? <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Apagar entrega de ${dateBR(d.delivered_on)}`} disabled={m.remove.isPending} onClick={() => run(() => m.remove.mutateAsync({ kind: "delivery", id: d.id }))}><Trash2 className="h-4 w-4" aria-hidden /></Button> : null}
                  </li>
                ))}
              </History>
            </section>
          );
        })}
        {ended.length > 0 ? <p className="text-xs text-muted-foreground">Encerrados: {ended.map((t) => `${t.medication} (até ${dateBR(t.ended_on)})`).join(", ")}</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </CardContent>
      {dlg?.kind === "treatment" ? <TreatmentDialog open onOpenChange={close} patientId={patientId} existing={dlg.t} /> : null}
      {dlg?.kind === "dose" ? <DoseDialog open onOpenChange={close} patientId={patientId} treatment={dlg.t} /> : null}
      {dlg?.kind === "application" ? <ApplicationDialog open onOpenChange={close} patientId={patientId} treatment={dlg.t} /> : null}
      {dlg?.kind === "delivery" ? <DeliveryDialog open onOpenChange={close} patientId={patientId} treatment={dlg.t} /> : null}
    </Card>
  );
}
