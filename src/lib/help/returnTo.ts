/**
 * Quem abre a Central de Ajuda sem estar logado volta para ela depois do login.
 * Guardado só na aba (sessionStorage) e só para caminhos da própria Central.
 */
const KEY = "vx_help_return_to";

export function isHelpPath(path: string | null | undefined): path is string {
  return typeof path === "string" && (path === "/ajuda" || path.startsWith("/ajuda/"));
}

export function rememberHelpReturn(path: string) {
  if (!isHelpPath(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    /* navegador sem storage: segue sem lembrar */
  }
}

/** Destino guardado (a Central apaga ao abrir, com clearHelpReturn). */
export function peekHelpReturn(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return isHelpPath(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearHelpReturn() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* sem storage */
  }
}
