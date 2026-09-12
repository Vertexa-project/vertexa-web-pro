const PROFILE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** {profile_id}/{16-64 hex}.webp|jpg — uma pasta, sem nome original. */
export const AVATAR_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{16,64}\.(webp|jpg)$/;

export function randomAvatarVersion(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildAvatarObjectPath(profileId: string, versionHex?: string): string {
  if (!PROFILE_UUID.test(profileId)) {
    throw new Error("invalid profile");
  }
  const version = versionHex ?? randomAvatarVersion();
  if (!/^[0-9a-f]{16,64}$/.test(version)) {
    throw new Error("invalid profile");
  }
  return `${profileId.toLowerCase()}/${version}.webp`;
}

export function isOwnAvatarObjectPath(path: string, profileId: string): boolean {
  if (!PROFILE_UUID.test(profileId)) return false;
  if (!AVATAR_PATH_PATTERN.test(path)) return false;
  return path.startsWith(`${profileId.toLowerCase()}/`);
}
