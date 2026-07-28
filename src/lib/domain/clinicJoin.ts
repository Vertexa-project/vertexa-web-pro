// Regras do CÓDIGO DE ACESSO À CLÍNICA e tradução dos erros das RPCs de join (WP-JOIN-1).
// PURAS (sem I/O), testáveis em Node — mesma convenção de clinicOnboarding.ts / disciplines.ts.
//
// Espelham a migration 20260803090000: alfabeto base32 SEM ambíguos (sem O/0 e sem I/1), 8 posições.
// A autoridade continua no banco (request_clinic_access resolve o código); aqui é só UX,
// normalização de digitação e classificação de erro — nunca erro cru, nunca PII.

/** Comprimento exato do código gerado por private.new_join_code(). */
export const JOIN_CODE_LENGTH = 8;

/** Alfabeto EXATO do gerador. Sem O, 0, I e 1 — o código é ditado por telefone. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const AMBIGUOUS = /[OI01]/;

/**
 * Normaliza o que a pessoa digitou/colou: maiúsculas e sem separadores (espaço, hífen, ponto,
 * underscore) — gente cola "abcd-efgh" ou "ABCD EFGH". NÃO remove caracteres inválidos: se
 * sobrar um O ou um 1, a validação abaixo avisa em vez de aceitar um código silenciosamente errado.
 */
export function normalizeJoinCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-._]/g, "");
}

export type JoinCodeValidation = { ok: true; value: string } | { ok: false; message: string };

/** Valida o código já normalizado com as MESMAS regras do gerador do banco. */
export function validateJoinCode(raw: string): JoinCodeValidation {
  const value = normalizeJoinCode(raw);
  if (value === "") return { ok: false, message: "Informe o código da clínica." };
  if (AMBIGUOUS.test(value)) {
    // Erro de digitação clássico. Dizer QUAL é a confusão poupa o suporte.
    return {
      ok: false,
      message: "O código não usa as letras O e I nem os números 0 e 1. Confira os caracteres.",
    };
  }
  if (value.length !== JOIN_CODE_LENGTH) {
    return { ok: false, message: `O código tem ${JOIN_CODE_LENGTH} caracteres.` };
  }
  if ([...value].some((c) => !JOIN_CODE_ALPHABET.includes(c))) {
    return { ok: false, message: "O código tem caracteres inválidos. Confira com a clínica." };
  }
  return { ok: true, value };
}

/** SQLSTATE de um erro de RPC (PostgrestError expõe `code`). Senão, null. */
export function joinErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** Erros ESPERADOS (validação/autorização) — não vão ao Sentry, viram mensagem. */
const EXPECTED = new Set(["P0002", "22023", "42501"]);

export function isExpectedJoinError(error: unknown): boolean {
  const code = joinErrorCode(error);
  return code !== null && EXPECTED.has(code);
}

/**
 * Mensagem para a SOLICITAÇÃO de acesso (lado do profissional pendente).
 *
 * ⚠️ P0002 é DELIBERADAMENTE NEUTRO. O banco devolve o mesmo erro para "código não existe" e a
 * mensagem aqui não afirma nada sobre a clínica existir — se dissesse "essa clínica não existe",
 * a tela viraria um oráculo para sondar códigos válidos.
 */
export function joinRequestErrorMessage(error: unknown): string {
  switch (joinErrorCode(error)) {
    case "P0002":
      return "Código inválido. Confira com o administrador da clínica.";
    case "22023":
      return "Esta conta já faz parte de uma clínica.";
    case "42501":
      return "Sua sessão expirou. Entre novamente para solicitar acesso.";
    default:
      return "Não foi possível enviar a solicitação agora. Tente novamente em instantes.";
  }
}

/** Mensagem para a ROTAÇÃO do código (lado do admin). */
export function rotateCodeErrorMessage(error: unknown): string {
  switch (joinErrorCode(error)) {
    case "42501":
      return "Apenas o administrador da clínica pode gerar um novo código.";
    case "P0002":
      return "Clínica não encontrada.";
    default:
      return "Não foi possível gerar um novo código agora. Tente novamente em instantes.";
  }
}

/** Texto pronto para compartilhar o código (WhatsApp). `origin` vem de window.location no chamador. */
export function shareInviteText(clinicName: string, code: string, origin: string): string {
  return (
    `Você foi convidada(o) para a equipe da ${clinicName} no VERTEXA.\n\n` +
    `1. Acesse ${origin}/login e entre com sua conta Google.\n` +
    `2. Informe o código de acesso: ${code}\n\n` +
    `Assim que eu aprovar, seu acesso é liberado.`
  );
}
