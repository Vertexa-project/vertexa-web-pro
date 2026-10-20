// Posição das fotos de progresso (frente / lado / costas) e regras de comparação.
// PURO e testável. Comparar só faz sentido entre posições EQUIVALENTES (frente × frente): a regra
// antiga "primeira × última" podia colocar uma foto de frente ao lado de uma de costas.
export const PHOTO_POSES = ["front", "side", "back"] as const;
export type PhotoPose = (typeof PHOTO_POSES)[number];
/** Chave de agrupamento: as 3 posições + "none" (foto ainda sem posição — inclui todas as antigas). */
export type PoseKey = PhotoPose | "none";

export const POSE_LABEL: Record<PoseKey, string> = {
  front: "Frente",
  side: "Lado",
  back: "Costas",
  none: "Sem posição",
};
/** Ordem de exibição (a de uma avaliação física: frente, lado, costas, depois o que falta classificar). */
export const POSE_ORDER: PoseKey[] = ["front", "side", "back", "none"];

export function isPhotoPose(v: unknown): v is PhotoPose {
  return typeof v === "string" && (PHOTO_POSES as readonly string[]).includes(v);
}

export interface PoseLike {
  taken_at: string | null;
  pose?: string | null;
}

export function poseKey(p: Pick<PoseLike, "pose">): PoseKey {
  return isPhotoPose(p.pose) ? p.pose : "none";
}

const time = (iso: string | null): number => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY; // sem data vai para o fim
};

/** Cópia ordenada da mais antiga para a mais recente (estável). */
export function sortAsc<T extends PoseLike>(list: readonly T[]): T[] {
  return list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => time(a.p.taken_at) - time(b.p.taken_at) || a.i - b.i)
    .map((x) => x.p);
}

export function groupByPose<T extends PoseLike>(list: readonly T[]): Record<PoseKey, T[]> {
  const out: Record<PoseKey, T[]> = { front: [], side: [], back: [], none: [] };
  for (const p of sortAsc(list)) out[poseKey(p)].push(p);
  return out;
}

export interface PhotoPairOf<T> {
  pose: PoseKey;
  /** null quando só existe uma foto naquela posição (não há o que comparar ainda). */
  before: T | null;
  after: T;
}

/**
 * Um par por posição que tenha foto: a mais antiga × a mais recente DAQUELA posição.
 * Posição com uma única foto vira par sem "antes" (mostra só o "depois"). Ordem: frente, lado, costas, sem posição.
 */
export function buildPairs<T extends PoseLike>(list: readonly T[]): Array<PhotoPairOf<T>> {
  const groups = groupByPose(list);
  const pairs: Array<PhotoPairOf<T>> = [];
  for (const key of POSE_ORDER) {
    const g = groups[key];
    if (g.length === 0) continue;
    pairs.push({ pose: key, before: g.length >= 2 ? g[0] : null, after: g[g.length - 1] });
  }
  return pairs;
}

/** Posições em que já dá para comparar (2+ fotos). */
export function comparablePoses<T extends PoseLike>(list: readonly T[]): PoseKey[] {
  const groups = groupByPose(list);
  return POSE_ORDER.filter((k) => groups[k].length >= 2);
}

/** Data (YYYY-MM-DD) escolhida para uma foto enviada pelo profissional. Devolve a mensagem de erro ou null. */
export function validatePhotoDate(day: string, today: string): string | null {
  if (!day) return "Informe a data da foto.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Data inválida.";
  if (day > today) return "A data da foto não pode estar no futuro.";
  if (day < "2000-01-01") return "Data inválida.";
  return null;
}

export const PHOTO_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — mesmo teto do app do paciente

export function validatePhotoFile(file: { type: string; size: number }): string | null {
  if (!(PHOTO_ALLOWED_MIME as readonly string[]).includes(file.type)) return "Formato não suportado. Envie uma imagem JPG, PNG ou WebP.";
  if (file.size > PHOTO_MAX_BYTES) return "Imagem muito grande. O limite é 10 MB.";
  return null;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** Path canônico no bucket privado: {patient_id}/{uuid}.ext — a 1ª pasta é o paciente (é o que a RLS confere). */
export function photoStorageKey(patientId: string, uuid: string, mime: string): string {
  if (!patientId) throw new Error("patient_id ausente ao montar o path da foto");
  return `${patientId}/${uuid}.${EXT[mime] ?? "jpg"}`;
}
