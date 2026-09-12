const SKIP = new Set([
  "de",
  "da",
  "do",
  "dos",
  "das",
  "e",
  "di",
  "du",
  "del",
  "dr",
  "dra",
]);

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[.]/g, "");
}

/**
 * Iniciais do avatar (superfícies novas). Primeira + última palavra significativa.
 * Partículas (de/da/dos/…) e títulos (Dr./Dra.) são ignorados.
 * Luana dos Santos Costa → LC. Não altera `initials()` das listas existentes.
 */
export function avatarInitials(name: string | null | undefined): string {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const significant = parts.filter((part) => !SKIP.has(normalizeToken(part)));
  const tokens = significant.length > 0 ? significant : parts;
  const first = tokens[0];
  if (!first) return "?";
  if (tokens.length === 1) return first.slice(0, 2).toUpperCase();
  const last = tokens[tokens.length - 1];
  return `${first[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
}
