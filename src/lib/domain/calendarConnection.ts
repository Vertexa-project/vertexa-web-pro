import { formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { CalendarConnectionStatus } from "@/types/db";

/**
 * Apresentação da conexão Google Calendar (Sessão 10/12) — compartilhado entre o card de
 * Configurações (GoogleCalendarConnection, variant="full") e o dropdown "Integrações" do topo
 * da agenda (IntegrationsMenu). A CHAMADA às Edge Functions vive nos hooks (useCalendarConnection)
 * — aqui só rótulo/tom/erro, sem duplicar a lógica de rede.
 */
export const CONNECTION_STATUS_META: Record<
  CalendarConnectionStatus,
  { label: string; tone: "success" | "destructive" | "warning" }
> = {
  connected: { label: "Conectado", tone: "success" },
  revoked: { label: "Acesso revogado", tone: "destructive" },
  error: { label: "Erro ao sincronizar", tone: "destructive" },
  stale: { label: "Agenda indisponível", tone: "warning" },
};

/** Mapeia os códigos de erro das Edge Functions para mensagens PT-BR amigáveis. */
export function connectionErrorMessage(code: string | undefined): string {
  switch (code) {
    case "google_not_configured":
      return "Integração ainda não configurada neste ambiente.";
    case "professional_clinic_mismatch":
      return "Profissional não pertence a esta clínica.";
    case "no_connection":
      return "Nenhuma agenda conectada para sincronizar.";
    case "revoked":
      return "O acesso ao Google foi revogado — reconecte a agenda.";
    case "calendar_not_found":
      return "A agenda não está mais disponível no Google.";
    default:
      return "Não foi possível concluir. Tente novamente.";
  }
}

export function lastSyncLabel(iso: string | null): string {
  if (!iso) return "Ainda não sincronizada";
  return `Sincronizada ${formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: ptBR })}`;
}
