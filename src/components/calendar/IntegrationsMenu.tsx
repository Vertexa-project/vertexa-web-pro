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
import { useRole } from "@/providers/role-context";

/**
 * Dropdown "Integrações" no topo da agenda (Sessão 12) — substitui o card de rodapé da S10.
 * Mostra o status da conexão Google + ações Conectar/Atualizar/Desconectar, cada uma admin-gated
 * via GatedAction + EDIT_REASON.calendar. Reusa os hooks da S10 (a CHAMADA às Edge Functions não é
 * duplicada). A gestão detalhada continua em Configurações (variant="full" do GoogleCalendarConnection).
 */
export function IntegrationsMenu({
  clinicId,
  professionalId,
}: {
  clinicId: string | null;
  professionalId: string | null;
}) {
  const { perms } = useRole();
  const isAdmin = perms.isAdmin;
  const { data: conn, isLoading } = useCalendarConnection(clinicId);
  const connect = useConnectGoogleCalendar();
  const sync = useSyncGoogleCalendar(clinicId ?? "none");
  const disconnect = useDisconnectGoogleCalendar(clinicId ?? "none");
  const [redirecting, setRedirecting] = useState(false);

  async function handleConnect() {
    if (!clinicId) return;
    try {
      const { url } = await connect.mutateAsync({ clinicId, professionalId, redirectTo: window.location.origin });
      setRedirecting(true);
      window.location.href = url; // navega para o consentimento do Google
    } catch (_e) {
      // erro exibido via connect.isError abaixo
    }
  }
  function handleSync() {
    if (clinicId) sync.mutate({ clinicId, professionalId });
  }
  function handleDisconnect() {
    if (!clinicId) return;
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
            : "Conecte (somente leitura) para ver os eventos do Google na agenda."}
        </p>

        <DropdownMenuSeparator />

        <div className="flex flex-col gap-1.5 pt-2">
          <GatedAction
            canEdit={isAdmin}
            reason={EDIT_REASON.calendar}
            variant="outline"
            size="sm"
            wrapperClassName="w-full"
            className="w-full justify-center"
            onClick={handleConnect}
            disabled={isAdmin && (connectBusy || !clinicId)}
          >
            {connectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {connected ? "Reconectar" : "Conectar Google Agenda"}
          </GatedAction>
          {connected ? (
            <GatedAction
              canEdit={isAdmin}
              reason={EDIT_REASON.calendar}
              variant="outline"
              size="sm"
              wrapperClassName="w-full"
              className="w-full justify-center"
              onClick={handleSync}
              disabled={isAdmin && (sync.isPending || !clinicId)}
            >
              {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar agenda
            </GatedAction>
          ) : null}
          {connected ? (
            <GatedAction
              canEdit={isAdmin}
              reason={EDIT_REASON.calendar}
              variant="outline"
              size="sm"
              wrapperClassName="w-full"
              className="w-full justify-center text-destructive hover:text-destructive"
              onClick={handleDisconnect}
              disabled={isAdmin && (disconnect.isPending || !clinicId)}
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
