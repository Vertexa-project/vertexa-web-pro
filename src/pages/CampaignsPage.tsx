import { useEffect, useMemo, useRef, useState } from "react";
import { Megaphone, Pencil, Send } from "lucide-react";

import { BroadcastDialog } from "@/components/campaigns/BroadcastDialog";
import { CampaignEditDialog } from "@/components/campaigns/CampaignEditDialog";
import { StatCard } from "@/components/dashboard/StatCard";
import { DataTable, type Column } from "@/components/data-table/DataTable";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBroadcasts, useCampaignSendCounts, useCampaigns, useEnsureCampaigns, useUpdateCampaign } from "@/hooks/useCampaigns";
import { useClinicBrand } from "@/hooks/useClinicBrand";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { AUDIENCE_LABEL, triggerMeta } from "@/lib/domain/campaigns";
import type { Campaign, CampaignBroadcast } from "@/types/db";

const fmtDate = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function CampaignsPage() {
  const { data, isLoading, isError, refetch } = useCampaigns();
  const sends = useCampaignSendCounts();
  const broadcasts = useBroadcasts();
  const brand = useClinicBrand();
  const clinicId = brand.data?.clinicId ?? null;
  const { isClinicAdmin } = useIsClinicAdmin(clinicId);
  const ensure = useEnsureCampaigns();
  const toggle = useUpdateCampaign();
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const ensured = useRef(false);

  // Admin: garante os modelos padrão (desligados) na primeira visita da clínica.
  useEffect(() => {
    if (ensured.current || !clinicId || !isClinicAdmin || !data) return;
    if (data.some((c) => c.trigger)) return;
    ensured.current = true;
    ensure.mutate(clinicId);
  }, [clinicId, isClinicAdmin, data, ensure]);

  const automations = useMemo(() => (data ?? []).filter((c) => triggerMeta(c.trigger)), [data]);
  const stats = useMemo(() => {
    const counts = sends.data ?? {};
    return {
      active: automations.filter((c) => c.is_active).length,
      sent30: automations.reduce((s, c) => s + (counts[c.id] ?? 0), 0),
      manual: (broadcasts.data ?? []).length,
    };
  }, [automations, sends.data, broadcasts.data]);

  function onToggle(c: Campaign) {
    setToggleError(null);
    toggle.mutate({ id: c.id, isActive: !c.is_active }, { onError: () => setToggleError("Só o administrador da clínica liga ou desliga as automações.") });
  }

  const broadcastColumns: Column<CampaignBroadcast>[] = [
    { key: "date", header: "Data", render: (b) => <span className="text-muted-foreground">{fmtDate(b.created_at)}</span> },
    { key: "title", header: "Mensagem", render: (b) => <span className="font-medium text-foreground">{b.title}</span> },
    { key: "aud", header: "Para", render: (b) => <span className="text-muted-foreground">{AUDIENCE_LABEL[b.audience]}{b.inactive_days ? ` (${b.inactive_days}+ dias)` : ""}</span> },
    { key: "n", header: "Pacientes", render: (b) => <span>{b.recipients}</span> },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Campanhas"
        description="Mensagens automáticas e disparos para os pacientes, na caixa de notificações do app."
        actions={clinicId ? (
          <Button onClick={() => setBroadcastOpen(true)}>
            <Send className="h-4 w-4" />
            Novo disparo
          </Button>
        ) : null}
      />

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={Megaphone} label="Automações ligadas" value={stats.active} tone="success" />
            <StatCard icon={Send} label="Enviadas em 30 dias" value={stats.sent30} tone="primary" />
            <StatCard icon={Megaphone} label="Disparos manuais" value={stats.manual} tone="warning" />
          </div>

          <section aria-label="Automações" className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Automações</h2>
              <p className="text-sm text-muted-foreground">Começam desligadas. Ligue as que fazem sentido para a clínica; cada paciente recebe a mesma mensagem uma vez por período.</p>
            </div>
            {toggleError ? <p className="text-sm text-destructive" role="alert">{toggleError}</p> : null}
            {automations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{isClinicAdmin ? "Preparando os modelos…" : "O administrador da clínica ainda não ativou as automações."}</p>
            ) : (
              automations.map((c) => {
                const meta = triggerMeta(c.trigger);
                return (
                  <Card key={c.id}>
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-foreground">{meta?.label ?? c.name}</h3>
                          <Badge tone={c.is_active ? "success" : "muted"}>{c.is_active ? "Ligada" : "Desligada"}</Badge>
                          <span className="text-xs text-muted-foreground">{sends.data?.[c.id] ?? 0} enviadas em 30 dias</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{meta?.when(c.days_threshold ?? meta.defaultDays)}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">“{c.message_template}”</p>
                      </div>
                      {isClinicAdmin ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditing(c)} aria-label={`Editar ${meta?.label ?? c.name}`}>
                            <Pencil className="h-4 w-4" />
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant={c.is_active ? "outline" : "default"}
                            role="switch"
                            aria-checked={c.is_active}
                            aria-label={`${c.is_active ? "Desligar" : "Ligar"} ${meta?.label ?? c.name}`}
                            disabled={toggle.isPending}
                            onClick={() => onToggle(c)}
                          >
                            {c.is_active ? "Desligar" : "Ligar"}
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </section>

          <section aria-label="Disparos manuais" className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Disparos manuais</h2>
            {(broadcasts.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum disparo ainda. Use “Novo disparo” para avisar um grupo de pacientes.</p>
            ) : (
              <DataTable columns={broadcastColumns} rows={broadcasts.data ?? []} getRowId={(b) => b.id} ariaLabel="Histórico de disparos" />
            )}
          </section>
        </>
      )}

      <CampaignEditDialog campaign={editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
      {clinicId ? <BroadcastDialog clinicId={clinicId} isAdmin={isClinicAdmin} open={broadcastOpen} onOpenChange={setBroadcastOpen} /> : null}
    </div>
  );
}
