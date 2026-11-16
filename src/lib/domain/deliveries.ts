// Enviar ao app do paciente (redesign P6) — regras PURAS: quem pode enviar o quê, nome do arquivo, texto de estado e a marca do PDF.
import type { DisciplinePermissions } from "./disciplines";
import { normalizeHexColor } from "./clinicBrand";
import { isoDateBRText } from "./patientReminders";
import { todayIsoBR } from "./stockMoves";

export type DeliveryKind = "treino" | "plano_alimentar" | "documento" | "relatorio";

export const DELIVERY_KIND_LABEL: Record<DeliveryKind, string> = {
  treino: "Treino",
  plano_alimentar: "Plano alimentar",
  documento: "Documento",
  relatorio: "Relatório",
};

/**
 * Quem envia: treino = disciplina de treino; plano alimentar = nutricionista; documento/relatório = quem tem acesso clínico ao paciente
 * (profissional da equipe do paciente ou admin). Espelho da função send_document_to_patient: a barreira real é o banco.
 */
export function canSendKind(kind: DeliveryKind, perms: DisciplinePermissions, isProfessional: boolean): boolean {
  if (!isProfessional) return false;
  if (kind === "treino") return perms.canEditWorkout;
  if (kind === "plano_alimentar") return perms.canEditNutrition;
  return true;
}

export const SEND_DENIED_REASON: Record<DeliveryKind, string> = {
  treino: "Requer a disciplina Educador Físico ou Fisioterapeuta.",
  plano_alimentar: "Requer a disciplina Nutricionista.",
  documento: "Só quem acompanha o paciente envia documentos.",
  relatorio: "Só quem acompanha o paciente envia relatórios.",
};

const slug = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/(^-|-$)/g, "").toLowerCase() || "paciente";

/** treino-maria-silva-2026-11-16.pdf (data de Brasília). */
export function deliveryFileName(kind: DeliveryKind, patientName: string, now: Date = new Date()): string {
  const prefix = kind === "plano_alimentar" ? "plano-alimentar" : kind;
  return `${prefix}-${slug(patientName)}-${todayIsoBR(now)}.pdf`;
}

/** Título que o paciente lê em "Meus documentos". */
export function deliveryTitle(kind: DeliveryKind, planTitle: string | null | undefined): string {
  const t = (planTitle ?? "").trim();
  return t ? `${DELIVERY_KIND_LABEL[kind]} · ${t}`.slice(0, 160) : DELIVERY_KIND_LABEL[kind];
}

export interface DeliveryState {
  id: string;
  document_id: string;
  kind: DeliveryKind;
  sent_at: string;
  first_opened_at: string | null;
  revoked_at: string | null;
}

export type DeliveryStatus = "no_app" | "visto" | "retirado" | "nao_enviado";

export function deliveryStatus(d: Pick<DeliveryState, "first_opened_at" | "revoked_at"> | null | undefined): DeliveryStatus {
  if (!d) return "nao_enviado";
  if (d.revoked_at) return "retirado";
  return d.first_opened_at ? "visto" : "no_app";
}

const brDate = (iso: string): string => isoDateBRText(todayIsoBR(new Date(iso)));

/** "Enviado em 16/11/2026 · visto em 17/11/2026" (datas de Brasília). */
export function deliveryStatusText(d: Pick<DeliveryState, "sent_at" | "first_opened_at" | "revoked_at"> | null | undefined): string {
  const st = deliveryStatus(d);
  if (!d || st === "nao_enviado") return "Não enviado";
  if (st === "retirado") return `Retirado do app em ${brDate(d.revoked_at as string)}`;
  const base = `Enviado em ${brDate(d.sent_at)}`;
  return st === "visto" ? `${base} · visto em ${brDate(d.first_opened_at as string)}` : base;
}

export interface PdfBrandInput {
  name: string | null | undefined;
  color: string | null | undefined;
  logoUri: string | null;
}
export interface PdfBrand {
  clinicName: string;
  logoUri: string | null;
  color: string | null;
}

/** Marca que vai no cabeçalho do PDF enviado: nome (sempre), logo (se houver) e cor da clínica (só hex válido). */
export function pdfBrandOf(b: PdfBrandInput): PdfBrand {
  return { clinicName: b.name?.trim() || "Clínica", logoUri: b.logoUri, color: normalizeHexColor(b.color) };
}

export function sendErrorMessage(err: unknown, kind: DeliveryKind): string {
  const m = (err as { message?: string; code?: string } | null) ?? {};
  if (m.code === "42501" || /forbidden/i.test(m.message ?? "")) return SEND_DENIED_REASON[kind];
  return "Não foi possível enviar ao paciente. Tente novamente.";
}
