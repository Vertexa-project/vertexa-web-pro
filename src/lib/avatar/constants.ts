/** Bucket privado dedicado. Não reutilizar progress-photos / patient-documents / chat-attachments. */
export const PROFILE_AVATARS_BUCKET = "profile-avatars";

/** Limite do arquivo ORIGINAL (antes do crop). O objeto final é ~512×512 webp. */
export const AVATAR_MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;

/** Teto do objeto processado (alinhado ao file_size_limit do bucket). */
export const AVATAR_MAX_PROCESSED_BYTES = 2 * 1024 * 1024;

export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_OUTPUT_QUALITY = 0.86;
export const AVATAR_SIGNED_URL_TTL_SECONDS = 3600;
/** staleTime/refetch abaixo do TTL para não reusar URL expirada no Topbar. */
export const AVATAR_SIGNED_URL_STALE_MS = 45 * 60 * 1000;
export const AVATAR_SIGNED_URL_REFETCH_MS = 45 * 60 * 1000;
export const AVATAR_SIGNED_URL_GC_MS = 50 * 60 * 1000;
export const AVATAR_MIN_ZOOM = 1;
export const AVATAR_MAX_ZOOM = 3;

export const AVATAR_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarAllowedMime = (typeof AVATAR_ALLOWED_MIME)[number];

/**
 * Futuro: AVATAR_FEATURE_ENTITLEMENT pode restringir upload/edit.
 * Neste WP a feature está disponível a qualquer usuário autenticado elegível (dono da própria foto).
 */
export const AVATAR_FEATURE_ENTITLEMENT = null;
