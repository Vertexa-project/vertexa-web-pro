// Ler PDF/foto (redesign P5) — contrato compartilhado entre a Edge Function `vertexa-doc-read` e o painel.
// Regras do guia da Vertexa IA: o resultado nasce RASCUNHO (nada vai para a ficha sem o profissional conferir),
// todo número vem do documento e traz a fonte (página/trecho), campo incerto exige conferir, sem diagnóstico.

export type DocKind = "bioimpedancia" | "dieta" | "treino";
export const DOC_KINDS: readonly DocKind[] = ["bioimpedancia", "dieta", "treino"];
export const isDocKind = (v: unknown): v is DocKind => typeof v === "string" && (DOC_KINDS as readonly string[]).includes(v);

export interface ReadGroup {
  id: string;
  title: string;
  subtitle?: string | null;
}

export interface ReadField {
  /** Chave estável (ex.: "peso", "m0.time", "d1.e2.reps"). */
  key: string;
  /** Refeição / dia de treino a que o campo pertence (null = medidas gerais). */
  group: string | null;
  /** Rótulo mostrado ao profissional (vem do documento quando é nome de item/exercício). */
  label: string;
  /** Valor em texto pt-BR ("70,3", "10/11/2026", "2 un"). null = não encontrado. */
  value: string | null;
  unit: string | null;
  /** Campo sem o qual a gravação não faz sentido (data, peso, % de gordura…). */
  required: boolean;
  /** Incerto: aparece em laranja e o profissional precisa conferir. */
  uncertain: boolean;
  reason: string | null;
  /** Alternativas lidas (o profissional escolhe uma). */
  options: string[] | null;
  /** Trecho do documento de onde o valor saiu (curto). */
  source: string | null;
  page: number | null;
  /** 0 a 1. Abaixo de CONFIDENCE_MIN o campo vira incerto. */
  confidence: number;
}

export interface DocReadResult {
  kind: DocKind;
  mode: "demo" | "openai";
  groups: ReadGroup[];
  fields: ReadField[];
  /** Aviso de leitura (ex.: foto sem a Vertexa IA ativa, PDF sem texto). */
  notice: string | null;
  /** Avisos de conferência (nome diferente do paciente etc.). */
  warnings: string[];
  /** Linhas do documento que não foram entendidas (máx. 10). */
  unrecognized: string[];
  /** false = nada foi lido (foto sem IA, arquivo vazio): todos os campos nascem vazios e incertos. */
  legible: boolean;
}

export const CONFIDENCE_MIN = 0.8;
export const NOTICE_PHOTO_NEEDS_AI = "A leitura de foto precisa da Vertexa IA ativa. Preencha os campos à mão ou envie um PDF com texto.";
export const NOTICE_NO_TEXT = "Este PDF não tem texto para ler (parece uma imagem escaneada). A leitura precisa da Vertexa IA ativa; preencha à mão.";
export const NOTICE_UNREADABLE = "Não consegui ler este arquivo. Nada foi salvo; preencha os campos à mão ou tente outro arquivo.";
