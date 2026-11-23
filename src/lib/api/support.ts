import { supabase } from "@/lib/supabase";

/** Suporte da Central de Ajuda (cartão 1317 · entrega 2). */

export type SupportCategory = "duvida" | "problema" | "sugestao" | "financeiro";
export type SupportStatus = "aberto" | "respondido" | "resolvido";
export type SupportSide = "clinica" | "vertexa";

export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> = {
  duvida: "Dúvida de uso",
  problema: "Algo não funciona",
  sugestao: "Sugestão",
  financeiro: "Assinatura e cobrança",
};

/** Rótulo do status visto pela clínica e pela equipe Vertexa. */
export function supportStatusLabel(status: SupportStatus, side: SupportSide): string {
  if (status === "resolvido") return "Resolvido";
  if (status === "respondido") return side === "clinica" ? "Respondido" : "Aguardando a clínica";
  return side === "clinica" ? "Aguardando o suporte" : "Aguardando resposta";
}

export const SUPPORT_BUCKET = "support-attachments";
export const SUPPORT_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface SupportClinic {
  clinicId: string;
  clinicName: string;
}

export interface SupportTicketRow {
  id: string;
  number: number;
  clinicName: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  unread: boolean;
  openedByName: string | null;
  createdAt: string;
  lastMessageAt: string;
}

export interface SupportMessage {
  id: string;
  authorSide: SupportSide;
  authorName: string | null;
  body: string;
  attachmentPath: string | null;
  createdAt: string;
}

export interface SupportTicketDetail {
  id: string;
  number: number;
  clinicName: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  createdAt: string;
  openedByName: string | null;
  viewerSide: SupportSide;
  messages: SupportMessage[];
}

interface TicketRowRaw {
  id: string;
  number: number | string;
  clinic_name: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  unread: boolean | null;
  opened_by_name: string | null;
  created_at: string;
  last_message_at: string;
}

function mapRow(r: TicketRowRaw): SupportTicketRow {
  return {
    id: r.id,
    number: Number(r.number),
    clinicName: r.clinic_name,
    subject: r.subject,
    category: r.category,
    status: r.status,
    unread: r.unread === true,
    openedByName: r.opened_by_name,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
  };
}

export function mapTicketDetail(raw: unknown): SupportTicketDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const msgs = Array.isArray(r.messages) ? (r.messages as Record<string, unknown>[]) : [];
  return {
    id: String(r.id),
    number: Number(r.number),
    clinicName: String(r.clinic_name ?? ""),
    subject: String(r.subject ?? ""),
    category: (r.category as SupportCategory) ?? "duvida",
    status: (r.status as SupportStatus) ?? "aberto",
    createdAt: String(r.created_at ?? ""),
    openedByName: (r.opened_by_name as string | null) ?? null,
    viewerSide: r.viewer_side === "vertexa" ? "vertexa" : "clinica",
    messages: msgs.map((m) => ({
      id: String(m.id),
      authorSide: m.author_side === "vertexa" ? "vertexa" : "clinica",
      authorName: (m.author_name as string | null) ?? null,
      body: String(m.body ?? ""),
      attachmentPath: (m.attachment_path as string | null) ?? null,
      createdAt: String(m.created_at ?? ""),
    })),
  };
}

export async function listSupportClinics(): Promise<SupportClinic[]> {
  const { data, error } = await supabase.rpc("support_my_clinics");
  if (error) throw error;
  return ((data ?? []) as { clinic_id: string; clinic_name: string }[]).map((r) => ({
    clinicId: r.clinic_id,
    clinicName: r.clinic_name,
  }));
}

export async function listMySupportTickets(): Promise<SupportTicketRow[]> {
  const { data, error } = await supabase.rpc("support_list_my_tickets");
  if (error) throw error;
  return ((data ?? []) as TicketRowRaw[]).map(mapRow);
}

export async function getMySupportUnread(): Promise<number> {
  const { data, error } = await supabase.rpc("support_my_unread_count");
  if (error) throw error;
  return Number(data ?? 0);
}

export async function listPlatformSupportTickets(status: SupportStatus | null): Promise<SupportTicketRow[]> {
  const { data, error } = await supabase.rpc("support_platform_list", { p_status: status });
  if (error) throw error;
  return ((data ?? []) as TicketRowRaw[]).map(mapRow);
}

export interface PlatformSupportCounts {
  aberto: number;
  respondido: number;
  resolvido: number;
  unread: number;
}

export async function getPlatformSupportCounts(): Promise<PlatformSupportCounts> {
  const { data, error } = await supabase.rpc("support_platform_counts");
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    aberto: Number(r.aberto ?? 0),
    respondido: Number(r.respondido ?? 0),
    resolvido: Number(r.resolvido ?? 0),
    unread: Number(r.unread ?? 0),
  };
}

export async function getSupportTicket(id: string): Promise<SupportTicketDetail | null> {
  const { data, error } = await supabase.rpc("support_get_ticket", { p_ticket_id: id });
  if (error) throw error;
  return mapTicketDetail(data);
}

function extFor(file: File): string {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

/** Confere o print antes de enviar; devolve a mensagem de erro para a tela ou null. */
export function validateSupportImage(file: File | null): string | null {
  if (!file) return null;
  if (!SUPPORT_MIME_TYPES.includes(file.type)) return "Envie uma imagem PNG, JPG ou WEBP.";
  if (file.size > SUPPORT_MAX_BYTES) return "A imagem passa de 5 MB. Envie uma menor.";
  return null;
}

async function attach(ticketId: string, messageId: string, file: File) {
  const path = `${ticketId}/${crypto.randomUUID()}.${extFor(file)}`;
  const up = await supabase.storage.from(SUPPORT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  const { error } = await supabase.rpc("support_set_attachment", { p_message_id: messageId, p_path: path });
  if (error) throw error;
}

export async function openSupportTicket(input: {
  clinicId: string;
  subject: string;
  category: SupportCategory;
  body: string;
  image: File | null;
}): Promise<{ ticketId: string; number: number; attachmentFailed: boolean }> {
  const { data, error } = await supabase.rpc("support_open_ticket", {
    p_clinic_id: input.clinicId,
    p_subject: input.subject,
    p_category: input.category,
    p_body: input.body,
  });
  if (error) throw error;
  const r = (data ?? {}) as { ticket_id: string; number: number; message_id: string };
  let attachmentFailed = false;
  if (input.image) {
    try {
      await attach(r.ticket_id, r.message_id, input.image);
    } catch {
      attachmentFailed = true;
    }
  }
  return { ticketId: r.ticket_id, number: Number(r.number), attachmentFailed };
}

export async function replySupportTicket(ticketId: string, body: string, image: File | null): Promise<{ attachmentFailed: boolean }> {
  const { data, error } = await supabase.rpc("support_reply", { p_ticket_id: ticketId, p_body: body });
  if (error) throw error;
  let attachmentFailed = false;
  if (image) {
    try {
      await attach(ticketId, String(data), image);
    } catch {
      attachmentFailed = true;
    }
  }
  return { attachmentFailed };
}

export async function setSupportStatus(ticketId: string, status: SupportStatus): Promise<void> {
  const { error } = await supabase.rpc("support_set_status", { p_ticket_id: ticketId, p_status: status });
  if (error) throw error;
}

export async function supportAttachmentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(SUPPORT_BUCKET).createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
}
