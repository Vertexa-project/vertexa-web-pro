// Exportar a base de pacientes (redesign parte 4). Só Gestor/admin. Prontuário NÃO entra: sai paciente a paciente, em PDF.
// O servidor (RPC export_patients) grava a auditoria e devolve as linhas na mesma transação; aqui só se monta o CSV.
import { importOriginLabel } from "@/lib/domain/patientImport";
import { toCsv, type ExportColumn } from "@/lib/domain/tableExport";
import { statusLabel } from "@/lib/domain/vri";
import type { FinAccess } from "@/lib/domain/finAccess";
import type { PatientStatus } from "@/types/db";

export type ExportGroup = "cadastro" | "contato" | "medidas" | "adesao";

export const EXPORT_GROUPS: { key: ExportGroup; label: string; hint: string }[] = [
  { key: "cadastro", label: "Cadastro", hint: "Nome, nascimento, sexo, objetivo, início e origem" },
  { key: "contato", label: "Contato", hint: "E-mail e telefone" },
  { key: "medidas", label: "Medidas e peso", hint: "Altura, peso inicial, peso atual, meta e data da última medida" },
  { key: "adesao", label: "Adesão", hint: "Status, pontuação e adesão da semana" },
];

export const EXPORT_NOTE = "Prontuário não entra na base: sai paciente a paciente, em PDF.";

export type ExportReasonKind = "backup" | "migracao" | "auditoria" | "pedido_titular" | "outro";

export const EXPORT_REASONS: { value: ExportReasonKind; label: string }[] = [
  { value: "backup", label: "Backup da clínica" },
  { value: "migracao", label: "Migração para outro sistema" },
  { value: "auditoria", label: "Auditoria ou conferência" },
  { value: "pedido_titular", label: "Pedido do próprio paciente" },
  { value: "outro", label: "Outro motivo" },
];

export const exportReasonLabel = (k: string): string => EXPORT_REASONS.find((r) => r.value === k)?.label ?? k;
export const exportGroupLabel = (k: string): string => EXPORT_GROUPS.find((g) => g.key === k)?.label ?? k;

export const EXPORT_REASON_MIN = 5;
export const EXPORT_REASON_MAX = 300;

/** Mensagem de erro (em português) ou null quando o pedido pode ir ao servidor. */
export function validateExportRequest(input: { groups: ExportGroup[]; kind: ExportReasonKind | ""; reason: string }): string | null {
  if (input.groups.length === 0) return "Escolha ao menos um grupo de dados.";
  if (!input.kind) return "Escolha o motivo da exportação.";
  const t = input.reason.trim();
  if (t.length < EXPORT_REASON_MIN) return "Explique o motivo em poucas palavras (mínimo de 5 letras).";
  if (t.length > EXPORT_REASON_MAX) return "O motivo passa de 300 caracteres.";
  return null;
}

export type ExportRow = Record<string, string | number | null | undefined>;

const dateBR = (iso: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

const SEX: Record<string, string> = { feminino: "Feminino", masculino: "Masculino", outro: "Outro" };

/** Planilha não pode executar o que vem de fora: texto que começa com = + - @ ou tabulação ganha um apóstrofo (telefone com + é preservado). */
export function safeCsvText(v: unknown): string {
  const s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !/^\+?[\d\s().-]+$/.test(s)) return `'${s}`;
  return s;
}

const text = (key: string) => (r: ExportRow) => safeCsvText(r[key]);
const num = (key: string) => (r: ExportRow) => (r[key] === null || r[key] === undefined ? null : Number(r[key]));

const COLUMNS: Record<ExportGroup, ExportColumn<ExportRow>[]> = {
  cadastro: [
    { header: "Nascimento", value: (r) => dateBR(r.nascimento) },
    { header: "Sexo", value: (r) => SEX[String(r.sexo ?? "")] ?? "" },
    { header: "Objetivo", value: text("objetivo") },
    { header: "Início do acompanhamento", value: (r) => dateBR(r.inicio) },
    { header: "Origem", value: (r) => (r.origem ? safeCsvText(importOriginLabel(String(r.origem))) : "") },
  ],
  contato: [
    { header: "E-mail", value: text("email") },
    { header: "Telefone", value: text("telefone") },
  ],
  medidas: [
    { header: "Altura (cm)", value: num("altura_cm"), kind: "qty" },
    { header: "Peso inicial (kg)", value: num("peso_inicial"), kind: "qty" },
    { header: "Peso atual (kg)", value: num("peso_atual"), kind: "qty" },
    { header: "Meta de peso (kg)", value: num("meta_peso"), kind: "qty" },
    { header: "Data da última medida", value: (r) => dateBR(r.ultima_medida) },
  ],
  adesao: [
    { header: "Status", value: (r) => (r.status ? statusLabel(r.status as PatientStatus) : "") },
    { header: "Pontuação", value: num("pontuacao"), kind: "qty" },
    { header: "Adesão da semana (%)", value: num("adesao_semanal"), kind: "pct" },
  ],
};

/** CSV para Excel BR: UTF-8 com BOM, separador `;`, vírgula decimal, datas dd/mm/aaaa, colunas na ordem dos grupos. */
export function buildExportCsv(groups: ExportGroup[], rows: ExportRow[]): string {
  const order = EXPORT_GROUPS.map((g) => g.key).filter((k) => groups.includes(k));
  const columns: ExportColumn<ExportRow>[] = [{ header: "Nome", value: text("nome") }, ...order.flatMap((g) => COLUMNS[g])];
  return toCsv(columns, rows);
}

export const exportFilename = (todayIso: string): string => `pacientes_vertexa_${todayIso}.csv`;

export const exportDoneMessage = (rowCount: number): string =>
  `Exportação registrada: ${rowCount} ${rowCount === 1 ? "paciente" : "pacientes"}. O arquivo contém dados pessoais; guarde em local seguro.`;

/** Só o admin da clínica ou o papel Gestor vê o botão de exportar (o servidor decide de novo na RPC). */
export const canExportPatientBase = (access: FinAccess): boolean =>
  access.isAdmin || access.roles.some((r) => r.role === "gestor");
