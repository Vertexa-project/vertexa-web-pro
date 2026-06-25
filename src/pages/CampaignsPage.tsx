import { useMemo, useState } from "react";
import { CheckCircle2, Megaphone, Send, Zap } from "lucide-react";

import { StatCard } from "@/components/dashboard/StatCard";
import { DataTable, type Column } from "@/components/data-table/DataTable";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCampaigns } from "@/hooks/useCampaigns";
import type { Campaign } from "@/types/db";

export function CampaignsPage() {
  const { data, isLoading, isError, refetch } = useCampaigns();
  const [notice, setNotice] = useState<string | null>(null);

  const stats = useMemo(() => {
    const list = data ?? [];
    const active = list.filter((c) => c.is_active).length;
    const triggers = new Set(list.map((c) => c.trigger).filter(Boolean)).size;
    return { total: list.length, active, triggers };
  }, [data]);

  const columns: Column<Campaign>[] = [
    {
      key: "name",
      header: "Campanha",
      render: (c) => <span className="font-medium text-foreground">{c.name}</span>,
    },
    {
      key: "trigger",
      header: "Gatilho",
      render: (c) => <span className="text-muted-foreground">{c.trigger ?? "—"}</span>,
    },
    {
      key: "template",
      header: "Mensagem",
      render: (c) => (
        <span className="line-clamp-1 max-w-md text-muted-foreground">{c.message_template ?? "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => (
        <Badge tone={c.is_active ? "success" : "muted"}>{c.is_active ? "Ativa" : "Inativa"}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campanhas"
        description="Automações de retenção: boas-vindas, check-ins, reativação e mais."
        actions={
          <Button onClick={() => setNotice("Disparo de campanha disponível em breve (placeholder na sprint).")}>
            <Send className="h-4 w-4" />
            Novo disparo
          </Button>
        }
      />

      {notice ? (
        <p className="text-sm text-info" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Nenhuma campanha"
          description="As campanhas de retenção da clínica aparecerão aqui."
          action={
            <Button onClick={() => setNotice("Criação de campanha disponível em breve (placeholder na sprint).")}>
              <Send className="h-4 w-4" />
              Criar primeira campanha
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={Megaphone} label="Campanhas" value={stats.total} tone="primary" />
            <StatCard icon={CheckCircle2} label="Ativas" value={stats.active} tone="success" />
            <StatCard icon={Zap} label="Gatilhos automáticos" value={stats.triggers} tone="warning" />
          </div>

          <DataTable columns={columns} rows={data} getRowId={(c) => c.id} ariaLabel="Lista de campanhas" />

          <Card>
            <CardContent className="flex flex-col gap-2 p-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                <Zap className="h-4 w-4" />
              </span>
              <p>
                As campanhas disparam por gatilho (novo paciente, pós-consulta, inatividade). Nesta fase o
                envio é simulado — a integração de WhatsApp e e-mail chega em seguida.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
