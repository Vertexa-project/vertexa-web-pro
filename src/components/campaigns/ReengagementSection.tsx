import { useState } from "react";
import { HeartHandshake, Pencil } from "lucide-react";

import { ReengagementEditDialog } from "@/components/campaigns/ReengagementEditDialog";
import { DataTable, type Column } from "@/components/data-table/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useReengagementConfig, useReengagementHistory, useReengagementOverview, useSaveReengagement } from "@/hooks/useReengagement";
import type { ReengagementOverviewRow } from "@/lib/api/reengagement";
import { fmtDayMonth, STATE_LABEL, STATE_TONE, whenText } from "@/lib/domain/reengagement";

interface Props { clinicId: string; isAdmin: boolean }

/** Sequência de reengajamento do paciente sumido (A6): mensagens, liga/desliga, situação por paciente e histórico. */
export function ReengagementSection({ clinicId, isAdmin }: Props) {
  const cfg = useReengagementConfig(clinicId);
  const overview = useReengagementOverview(clinicId);
  const history = useReengagementHistory(clinicId);
  const save = useSaveReengagement(clinicId);
  const [editing, setEditing] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const config = cfg.data;
  const names = new Map((overview.data ?? []).map((r) => [r.patient_id, r.full_name]));

  function toggle() {
    if (!config) return;
    setToggleError(null);
    save.mutate({ ...config, isActive: !config.isActive }, { onError: () => setToggleError("Só o administrador da clínica liga ou desliga a sequência.") });
  }

  const columns: Column<ReengagementOverviewRow>[] = [
    {
      key: "patient", header: "Paciente",
      render: (r) => (
        <div>
          <span className="font-medium text-foreground">{r.full_name}</span>
          <span className="block text-xs text-muted-foreground sm:hidden">{r.idle_days} {r.idle_days === 1 ? "dia" : "dias"} sem interação</span>
        </div>
      ),
    },
    { key: "state", header: "Situação", render: (r) => <Badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Badge> },
    { key: "step", header: "Mensagem", render: (r) => (r.steps_sent > 0 ? `${r.steps_sent} de 3` : r.last_step ? `${r.last_step} de 3 (ciclo anterior)` : "—") },
    { key: "last", header: "Última", className: "hidden sm:table-cell", headerClassName: "hidden sm:table-cell", render: (r) => <span className="text-muted-foreground">{fmtDayMonth(r.last_sent_on)}</span> },
    { key: "idle", header: "Sem interação", className: "hidden sm:table-cell", headerClassName: "hidden sm:table-cell", render: (r) => <span className="text-muted-foreground">{r.idle_days} {r.idle_days === 1 ? "dia" : "dias"}</span> },
  ];

  return (
    <section aria-label="Reengajamento" className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">Reengajamento de paciente sumido</h2>
        <p className="text-sm text-muted-foreground">Uma sequência de 3 mensagens para quem some. Começa desligada. Se a “Reativação de inativos” também estiver ligada, o paciente recebe as duas.</p>
      </div>
      {toggleError ? <p className="text-sm text-destructive" role="alert">{toggleError}</p> : null}
      {cfg.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando a sequência…</p>
      ) : !config ? (
        <p className="text-sm text-destructive" role="alert">Não foi possível carregar a sequência.</p>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <HeartHandshake className="h-4 w-4 text-primary-ink" aria-hidden />
                  <h3 className="font-medium text-foreground">Sequência de 3 mensagens</h3>
                  <Badge tone={config.isActive ? "success" : "muted"}>{config.isActive ? "Ligada" : "Desligada"}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{whenText(config)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Chega como aviso no app{config.sendChat ? " e como mensagem da equipe na conversa (o paciente pode responder)" : ""}.
                </p>
              </div>
              {isAdmin ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)} aria-label="Editar Reengajamento">
                    <Pencil className="h-4 w-4" />
                    Editar
                  </Button>
                  <Button
                    size="sm" variant={config.isActive ? "outline" : "default"} role="switch" aria-checked={config.isActive}
                    aria-label={`${config.isActive ? "Desligar" : "Ligar"} Reengajamento`} disabled={save.isPending} onClick={toggle}
                  >
                    {config.isActive ? "Desligar" : "Ligar"}
                  </Button>
                </div>
              ) : null}
            </div>
            <ol className="space-y-2">
              {config.steps.map((s, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground">Mensagem {i + 1} · {s.day} dias sem interação</p>
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="line-clamp-3 text-sm text-muted-foreground">“{s.body}”</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Pacientes na sequência</h3>
        {overview.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : overview.isError ? (
          <p className="text-sm text-destructive" role="alert">Não foi possível carregar os pacientes.</p>
        ) : (overview.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum paciente sumido no momento.</p>
        ) : (
          <DataTable columns={columns} rows={overview.data ?? []} getRowId={(r) => r.patient_id} ariaLabel="Pacientes no reengajamento" />
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Histórico de envios</h3>
        {(history.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mensagem de reengajamento enviada ainda.</p>
        ) : (
          <ul aria-label="Histórico de reengajamento" className="divide-y rounded-lg border border-border">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{fmtDayMonth(h.sent_on)}</span>
                <span className="font-medium text-foreground">{names.get(h.patient_id) ?? "Paciente"}</span>
                <span className="text-muted-foreground">Mensagem {h.step} de 3 · {h.title}</span>
                {h.simulated ? <Badge tone="warning">Teste</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {config ? <ReengagementEditDialog clinicId={clinicId} config={config} open={editing} onOpenChange={setEditing} /> : null}
    </section>
  );
}
