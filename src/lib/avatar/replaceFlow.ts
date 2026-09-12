export interface ReplaceAvatarDeps {
  upload: (path: string, blob: Blob) => Promise<void>;
  setPath: (path: string) => Promise<string | null>;
  removeObject: (path: string) => Promise<void>;
  path: string;
  blob: Blob;
  previousPath: string | null;
}

/**
 * Ordem segura: processado já veio no blob → upload novo → RPC (autoridade) → apaga anterior.
 * Se o RPC falha, remove o objeto novo (órfão). Falha no delete anterior NÃO reverte a foto nova.
 */
export async function replaceAvatarWithCleanup(deps: ReplaceAvatarDeps): Promise<string> {
  await deps.upload(deps.path, deps.blob);
  let previous: string | null;
  try {
    previous = await deps.setPath(deps.path);
  } catch (err) {
    try {
      await deps.removeObject(deps.path);
    } catch {
      // órfão: cleanup posterior
    }
    throw err;
  }
  const stale = previous ?? deps.previousPath;
  if (stale && stale !== deps.path) {
    try {
      await deps.removeObject(stale);
    } catch {
      // cleanup posterior — a foto nova já é a autoridade
    }
  }
  return deps.path;
}

export async function removeAvatarWithCleanup(deps: {
  clearPath: () => Promise<string | null>;
  removeObject: (path: string) => Promise<void>;
}): Promise<void> {
  const previous = await deps.clearPath();
  if (!previous) return;
  try {
    await deps.removeObject(previous);
  } catch {
    // referência já limpa; objeto órfão fica para cleanup
  }
}
