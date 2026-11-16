// Ler PDF/foto — cliente da Edge Function `vertexa-doc-read` (a função só lê e deixa o rastro; quem grava é a Conferência).
import { supabase } from "@/lib/supabase";
import type { DocKind, DocReadResult } from "@/lib/domain/docImport";

export interface DocReadAnswer {
  mode: "demo" | "openai";
  read_id: string;
  result: DocReadResult;
}

async function invokeFn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("vertexa-doc-read", { body });
  if (error) {
    let code = "function_error";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const p = (await ctx.json()) as { error?: string };
        if (p?.error) code = String(p.error);
      } catch {
        // corpo não-JSON
      }
    }
    if (ctx && typeof ctx.status === "number" && ctx.status === 404 && code === "function_error") code = "not_deployed";
    throw new Error(code);
  }
  return data as T;
}

export const readDocument = (patientId: string, kind: DocKind, filePath: string) =>
  invokeFn<DocReadAnswer>({ action: "read", patient_id: patientId, kind, file_path: filePath });

/** Rastro da decisão (quem confirmou/descartou e quantos campos foram corrigidos — sem valores). */
export const resolveDocRead = (readId: string, decision: "confirmado" | "descartado", extra: { fieldsCorrected?: number; documentId?: string | null } = {}) =>
  invokeFn<{ ok: boolean }>({ action: "resolve", read_id: readId, decision, fields_corrected: extra.fieldsCorrected ?? 0, document_id: extra.documentId ?? null });

const MESSAGES: Record<string, string> = {
  not_deployed: "A leitura de documentos ainda não está ativa neste ambiente. Nada foi salvo.",
  unauthenticated: "Sua sessão expirou. Entre de novo para importar.",
  forbidden: "Seu perfil não tem acesso a esta clínica.",
  sem_acesso: "Seu perfil não pode abrir os dados clínicos deste paciente.",
  sem_disciplina: "Você não tem a disciplina necessária para importar este tipo de documento.",
  file_not_found: "Não encontrei o arquivo enviado. Tente de novo.",
  file_too_large: "Arquivo muito grande. O limite é 15 MB.",
  unsupported_type: "Formato não suportado. Envie PDF, JPG ou PNG.",
  unreadable_file: "Não consegui abrir este arquivo. Tente outro.",
  already_resolved: "Esta leitura já foi decidida.",
};
export const friendlyDocReadError = (code: string) => MESSAGES[code] ?? "Não consegui ler o arquivo agora. Nada foi salvo. Tente de novo.";
