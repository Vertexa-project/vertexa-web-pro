import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Link2, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { GatedAction } from "@/components/patient/GatedAction";
import { Badge } from "@/components/ui/badge";
import {
  useCalendarConnection,
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useSyncGoogleCalendar,
} from "@/hooks/useCalendarConnection";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import {
  CONNECTION_STATUS_META,
  connectionErrorMessage,
  lastSyncLabel,
} from "@/lib/domain/calendarConnection";
import { EDIT_REASON } from "@/lib/domain/roles";

/**
 * Integração Google Calendar (Sessão 10) — read-only, multi-tenant. Todas as ações são admin-gated
 * (RBAC de UI da S7); a barreira real fica no servidor (tokens deny-all + Edge Function/service_role).
 * `compact` = rodapé do AgendaCard (status + conectar/atualizar + link p/ gerenciar);
 * `full` = card de Integrações em Configurações (status + conta/agenda + conectar/atualizar/desconectar).
 */
export function GoogleCalendarConnection({
  clinicId,
  professionalId,
  variant,
}: {
  clinicId: string | null;
  professionalId: string | null;
  variant: "compact" | "full";
}) {
  // Admin da clínica pelo SINAL REAL do banco (dono OU clinic_role='admin'), não por profiles.role.
  const { isClinicAdmin: isAdmin } = useIsClinicAdmin(clinicId);
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

  // ---- Botões reutilizados ----
  const connectButton = (
    <GatedAction
      canEdit={isAdmin}
      reason={EDIT_REASON.calendar}
      variant="outline"
      size="sm"
      onClick={handleConnect}
      disabled={connectBusy || !clinicId}
    >
      {connectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
      {connected ? "Reconectar" : "Conectar Google Agenda"}
    </GatedAction>
  );
  const syncButton = (
    <GatedAction
      canEdit={isAdmin}
      reason={EDIT_REASON.calendar}
      variant="outline"
      size="sm"
      onClick={handleSync}
      disabled={sync.isPending || !clinicId}
    >
      {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      Atualizar agenda
    </GatedAction>
  );

  // ---- COMPACT (rodapé do AgendaCard) ----
  if (variant === "compact") {
    return (
      <div className="mt-4 border-t pt-3">
        {isLoading ? (
          <p className="text-center text-xs text-muted-foreground">Verificando Google Agenda…</p>
        ) : connected && conn ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <CalendarCheck className="h-4 w-4 text-success" aria-hidden />
                Google Agenda
                {statusMeta ? <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge> : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {conn.google_account_email ?? "conta conectada"} · {lastSyncLabel(conn.last_synced_at)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Sync só para admin no rodapé compacto (evita o bloco de motivo do GatedAction inflar a
                  linha p/ não-admin). Não-admin gerencia em Configurações, onde o motivo aparece. */}
              {isAdmin ? syncButton : null}
              <Link to="/configuracoes" className="text-xs font-medium text-primary hover:underline">
                Gerenciar
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            {connectButton}
            <p className="text-center text-xs text-muted-foreground">
              Veja seus compromissos do Google aqui (somente leitura). Google Meet não entra.
            </p>
          </div>
        )}
        {(connectError || syncError) && (
          <p className="mt-1.5 text-center text-xs text-destructive" role="alert">
            {connectError ?? syncError}
          </p>
        )}
      </div>
    );
  }

  // ---- FULL (card de Integrações em Configurações) ----
  return (
    <div className="space-y-3 py-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">Status</span>
        {isLoading ? (
          <span className="text-sm text-muted-foreground">Verificando…</span>
        ) : statusMeta ? (
          <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
        ) : (
          <Badge tone="muted">Não conectado</Badge>
        )}
      </div>

      {connected && conn ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Conta</span>
            <span className="truncate text-sm font-medium text-foreground">
              {conn.google_account_email ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Agenda</span>
            <span className="truncate text-sm font-medium text-foreground">{conn.calendar_name ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Última sincronização</span>
            <span className="text-sm font-medium text-foreground">{lastSyncLabel(conn.last_synced_at)}</span>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Conecte a agenda do Google (somente leitura) para ver os compromissos no Dashboard. Google Meet não entra.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {connectButton}
        {connected ? syncButton : null}
        {connected ? (
          <GatedAction
            canEdit={isAdmin}
            reason={EDIT_REASON.calendar}
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleDisconnect}
            disabled={disconnect.isPending || !clinicId}
          >
            {disconnect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Desconectar
          </GatedAction>
        ) : null}
      </div>

      {(connectError || syncError || disconnectError) && (
        <p className="text-xs text-destructive" role="alert">
          {connectError ?? syncError ?? disconnectError}
        </p>
      )}
    </div>
  );
}
