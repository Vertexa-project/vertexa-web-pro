// Quem pode ler documento para qual plano. ESPELHO de src/lib/domain/disciplines.ts (DISCIPLINE_WRITE_MAP) e de
// vertexa-ai/_shared/vertexa/access.ts (papéis sem acesso clínico). O teste docread.test.ts trava o espelho.
import type { DocKind } from "./types.ts";

export const NON_CLINICAL_ROLES = new Set(["recepcao", "financeiro", "estoquista"]);

export function hasClinicalAccess(isAdmin: boolean, staffRoles: string[]): boolean {
  if (isAdmin) return true;
  if (staffRoles.length === 0) return true;
  return !staffRoles.every((r) => NON_CLINICAL_ROLES.has(r));
}

/** Disciplinas que escrevem aquilo que o documento vai virar (UNIÃO). */
export const DOC_WRITE_DISCIPLINES: Record<DocKind, readonly string[]> = {
  bioimpedancia: ["nutricionista", "educador_fisico", "fisioterapeuta", "medico"],
  dieta: ["nutricionista"],
  treino: ["educador_fisico", "fisioterapeuta"],
};

export const canReadDocFor = (kind: DocKind, disciplines: readonly string[]): boolean =>
  DOC_WRITE_DISCIPLINES[kind].some((d) => disciplines.includes(d));

export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Tipo REAL pelo conteúdo (não confia no nome nem no mime enviado). */
export function sniffMime(b: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  const at = (i: number) => b[i] ?? 0;
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return "application/pdf";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45) return "image/webp";
  return null;
}
