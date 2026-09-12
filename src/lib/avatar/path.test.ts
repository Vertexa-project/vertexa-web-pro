import { describe, expect, it } from "vitest";

import { AVATAR_PATH_PATTERN, buildAvatarObjectPath, isOwnAvatarObjectPath } from "./path";

const PROFILE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";

describe("buildAvatarObjectPath", () => {
  it("usa pasta = profile_id e versão hex + webp — nunca o nome original", () => {
    const path = buildAvatarObjectPath(PROFILE, "0123456789abcdef0123456789abcdef");
    expect(path).toBe(`${PROFILE}/0123456789abcdef0123456789abcdef.webp`);
    expect(path).not.toMatch(/foto|jpg|png|clinic/i);
  });

  it("recusa profile_id que não é uuid", () => {
    expect(() => buildAvatarObjectPath("../evil", "aa".repeat(16))).toThrow(/profile/i);
    expect(() => buildAvatarObjectPath("not-a-uuid", "aa".repeat(16))).toThrow(/profile/i);
  });
});

describe("isOwnAvatarObjectPath / AVATAR_PATH_PATTERN", () => {
  it("aceita o contrato {profile_id}/{16-64 hex}.webp|jpg", () => {
    const ok = `${PROFILE}/0123456789abcdef0123456789abcdef.webp`;
    expect(AVATAR_PATH_PATTERN.test(ok)).toBe(true);
    expect(isOwnAvatarObjectPath(ok, PROFILE)).toBe(true);
    expect(isOwnAvatarObjectPath(ok, OTHER)).toBe(false);
  });

  it("recusa traversal, pasta extra, nome original e extensão perigosa", () => {
    expect(isOwnAvatarObjectPath(`${PROFILE}/../${OTHER}/x.webp`, PROFILE)).toBe(false);
    expect(isOwnAvatarObjectPath(`${PROFILE}/a/b.webp`, PROFILE)).toBe(false);
    expect(isOwnAvatarObjectPath(`${PROFILE}/foto-luana.webp`, PROFILE)).toBe(false);
    expect(isOwnAvatarObjectPath(`${PROFILE}/0123456789abcdef0123456789abcdef.svg`, PROFILE)).toBe(false);
    expect(isOwnAvatarObjectPath(`${OTHER}/0123456789abcdef0123456789abcdef.webp`, PROFILE)).toBe(false);
  });
});
