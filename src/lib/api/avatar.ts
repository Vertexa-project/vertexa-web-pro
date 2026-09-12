import { PROFILE_AVATARS_BUCKET, AVATAR_SIGNED_URL_TTL_SECONDS } from "@/lib/avatar/constants";
import { sanitizeAvatarError } from "@/lib/avatar/messages";
import { buildAvatarObjectPath } from "@/lib/avatar/path";
import { removeAvatarWithCleanup, replaceAvatarWithCleanup } from "@/lib/avatar/replaceFlow";
import { uniqueAvatarPaths } from "@/lib/avatar/signedUrlBatch";
import { supabase } from "@/lib/supabase";

export interface ProfileAvatarFields {
  id: string;
  full_name: string | null;
  avatar_path: string | null;
  avatar_url: string | null;
}

export async function getProfileAvatarFields(profileId: string): Promise<ProfileAvatarFields | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_path, avatar_url")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileAvatarFields | null) ?? null;
}

export async function getAvatarSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PROFILE_AVATARS_BUCKET)
    .createSignedUrl(path, AVATAR_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error("sign-failed");
  }
  return data.signedUrl;
}

/**
 * Uma chamada `createSignedUrls` para o conjunto único. Falha parcial: o path some do Map
 * (a UI cai em iniciais). Não persiste URL. Erro de lote vira "sign-failed" sanitizado.
 */
export async function getAvatarSignedUrls(
  paths: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = uniqueAvatarPaths(paths);
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data, error } = await supabase.storage
    .from(PROFILE_AVATARS_BUCKET)
    .createSignedUrls(unique, AVATAR_SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error("sign-failed");

  for (const row of data ?? []) {
    const extra = row as { signedURL?: string };
    const path = row.path ?? "";
    const url = row.signedUrl || extra.signedURL || "";
    if (path && url && !row.error) map.set(path, url);
  }
  return map;
}

export async function replaceMyAvatar(input: {
  profileId: string;
  blob: Blob;
  previousPath: string | null;
}): Promise<string> {
  const mime = input.blob.type === "image/jpeg" ? "image/jpeg" : "image/webp";
  const path =
    mime === "image/jpeg"
      ? buildAvatarObjectPath(input.profileId).replace(/\.webp$/, ".jpg")
      : buildAvatarObjectPath(input.profileId);

  try {
    return await replaceAvatarWithCleanup({
      path,
      blob: input.blob,
      previousPath: input.previousPath,
      upload: async (objectPath, blob) => {
        const { error } = await supabase.storage.from(PROFILE_AVATARS_BUCKET).upload(objectPath, blob, {
          contentType: mime,
          upsert: false,
          cacheControl: "31536000",
        });
        if (error) throw new Error(sanitizeAvatarError(error, "upload"));
      },
      setPath: async (objectPath) => {
        const { data, error } = await supabase.rpc("set_my_avatar", { p_path: objectPath });
        if (error) throw new Error(sanitizeAvatarError(error, "save"));
        return (data as string | null) ?? null;
      },
      removeObject: async (objectPath) => {
        const { error } = await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([objectPath]);
        if (error) throw error;
      },
    });
  } catch (err) {
    if (err instanceof Error && /Falha/.test(err.message)) throw err;
    throw new Error(sanitizeAvatarError(err, "save"));
  }
}

export async function removeMyAvatar(): Promise<void> {
  try {
    await removeAvatarWithCleanup({
      clearPath: async () => {
        const { data, error } = await supabase.rpc("remove_my_avatar");
        if (error) throw new Error(sanitizeAvatarError(error, "remove"));
        return (data as string | null) ?? null;
      },
      removeObject: async (objectPath) => {
        const { error } = await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([objectPath]);
        if (error) throw error;
      },
    });
  } catch (err) {
    if (err instanceof Error && /Falha/.test(err.message)) throw err;
    throw new Error(sanitizeAvatarError(err, "remove"));
  }
}
