import { describe, expect, it } from "vitest";

import { uniqueAvatarPaths } from "./signedUrlBatch";

describe("uniqueAvatarPaths", () => {
  it("remove null/undefined/vazio e deduplica", () => {
    expect(
      uniqueAvatarPaths(["b/x.webp", null, "a/y.webp", undefined, "b/x.webp", "  ", ""]),
    ).toEqual(["a/y.webp", "b/x.webp"]);
  });

  it("lista vazia ou só nulos vira []", () => {
    expect(uniqueAvatarPaths([])).toEqual([]);
    expect(uniqueAvatarPaths([null, undefined, ""])).toEqual([]);
  });
});
