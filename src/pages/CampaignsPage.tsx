import { useState } from "react";
import { Megaphone, Send } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/DataTable";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCampaigns } from "@/hooks/useCampaigns";
import type { Campaign } from "@/types/db";

export function CampaignsPage() {
  const { data, isLoading, isError, refetch } = useCampaigns();
  const [notice, setNotice] = useState<string | null>(null);

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
        />
      ) : (
        <DataTable columns={columns} rows={data} getRowId={(c) => c.id} ariaLabel="Lista de campanhas" />
      )}
    </div>
  );
}
