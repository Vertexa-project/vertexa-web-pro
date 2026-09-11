import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, ChevronDown, Link2, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { GatedAction } from "@/components/patient/GatedAction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCalendarConnection,
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useSyncGoogleCalendar,
} from "@/hooks/useCalendarConnection";
import {
  CONNECTION_STATUS_META,
  connectionErrorMessage,
  lastSyncLabel,
} from "@/lib/domain/calendarConnection";
import { EDIT_REASON } from "@/lib/domain/roles";

/**
 * Dropdown "Integrações" no topo da agenda — status + ações da Google Agenda do PRÓPRIO profissional.
 */
export function IntegrationsMenu({
  clinicId,
  professionalId,
}: {
  clinicId: string | null;
  professionalId: string | null;
}) {
  const canManageOwn = Boolean(clinicId && professionalId);
  const { data: conn, isLoading } = useCalendarConnection(clinicId, professionalId);
  const connect = useConnectGoogleCalendar();
  const sync = useSyncGoogleCalendar(clinicId ?? "none", professionalId ?? "none");
  const disconnect = useDisconnectGoogleCalendar(clinicId ?? "none", professionalId ?? "none");
  const [redirecting, setRedirecting] = useState(false);

  async function handleConnect() {
    if (!clinicId || !professionalId) return;
    try {
      const { url } = await connect.mutateAsync({ clinicId, professionalId, redirectTo: window.location.origin });
      setRedirecting(true);
      window.location.href = url;
    } catch (_e) {
      // erro exibido via connect.isError abaixo
    }
  }
  function handleSync() {
    if (clinicId && professionalId) sync.mutate({ clinicId, professionalId });
  }
  function handleDisconnect() {
    if (!clinicId || !professionalId) return;
    if (window.confirm("Desconectar o Google Calendar? Os eventos sincronizados saem do painel.")) {
      disconnect.mutate({ clinicId, professionalId });
    }
  }

  const connectBusy = connect.isPending || redirecting;
  const connected = Boolean(conn);
  const statusMeta = conn ? CONNECTION_STATUS_META[conn.status] : null;
  const connectError = connect.isError ? connectionErrorMessage((connect.error as Error)?.message) : null;
  const syncError = sync.isError ? connectionErrorMessage((sync.error as Error)?.message) : null;
  const disconnectError = disconnect.isError ? connectionErrorMessage((disconnect.error as Error)?.message) : null;
  const anyError = connectError ?? syncError ?? disconnectError;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarCheck className="h-4 w-4" />
          Integrações
          <ChevronDown className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">Google Agenda</span>
          {isLoading ? (
            <span className="text-xs text-muted-foreground">Verificando…</span>
          ) : statusMeta ? (
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          ) : (
            <Badge tone="muted">Não conectado</Badge>
          )}
        </div>
        <p className="mb-2 truncate text-xs text-muted-foreground">
          {connected && conn
            ? `${conn.google_account_email ?? "conta conectada"} · ${lastSyncLabel(conn.last_synced_at)}`
            : "Conecte a sua agenda (somente leitura) para ver os seus eventos do Google."}
        </p>

        <DropdownMenuSeparator />

        <div className="flex flex-col gap-1.5 pt-2">
          <GatedAction
            canEdit={canManageOwn}
            reason={EDIT_REASON.calendar}
            variant="outline"
            size="sm"
            wrapperClassName="w-full"
            className="w-full justify-center"
            onClick={handleConnect}
            disabled={canManageOwn && (connectBusy || !clinicId)}
          >
            {connectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {connected ? "Reconectar" : "Conectar Google Agenda"}
          </GatedAction>
          {connected ? (
            <GatedAction
              canEdit={canManageOwn}
              reason={EDIT_REASON.calendar}
              variant="outline"
              size="sm"
              wrapperClassName="w-full"
              className="w-full justify-center"
              onClick={handleSync}
              disabled={canManageOwn && (sync.isPending || !clinicId)}
            >
              {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar agenda
            </GatedAction>
          ) : null}
          {connected ? (
            <GatedAction
              canEdit={canManageOwn}
              reason={EDIT_REASON.calendar}
              variant="outline"
              size="sm"
              wrapperClassName="w-full"
              className="w-full justify-center text-destructive hover:text-destructive"
              onClick={handleDisconnect}
              disabled={canManageOwn && (disconnect.isPending || !clinicId)}
            >
              {disconnect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Desconectar
            </GatedAction>
          ) : null}
        </div>

        {anyError ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {anyError}
          </p>
        ) : null}

        <Link
          to="/configuracoes"
          className="mt-2 block text-center text-xs font-medium text-primary hover:underline"
        >
          Gerenciar em Configurações
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
