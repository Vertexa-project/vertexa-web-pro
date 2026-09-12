/** Paths únicos, estáveis e ordenados — chave de cache e input do batch sign. */
export function uniqueAvatarPaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const path of paths) {
    const trimmed = typeof path === "string" ? path.trim() : "";
    if (trimmed) seen.add(trimmed);
  }
  return [...seen].sort();
}
