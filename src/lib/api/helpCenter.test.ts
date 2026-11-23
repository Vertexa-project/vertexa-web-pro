import { describe, expect, it } from "vitest";

import { groupHelpArticles, mapHelpCenterAccess } from "./helpCenter";

describe("mapHelpCenterAccess", () => {
  it("só libera com allowed true", () => {
    expect(mapHelpCenterAccess({ allowed: true, reason: "ok", platform_admin: false })).toEqual({
      allowed: true,
      reason: "ok",
      platformAdmin: false,
    });
    expect(mapHelpCenterAccess({ allowed: "true" }).allowed).toBe(false);
    expect(mapHelpCenterAccess(null)).toEqual({ allowed: false, reason: "not_subscribed", platformAdmin: false });
  });
});

describe("groupHelpArticles", () => {
  it("agrupa por categoria mantendo a ordem do servidor", () => {
    const row = (slug: string, cat: string, title: string) => ({
      slug,
      category_id: cat,
      category_title: cat.toUpperCase(),
      category_description: null,
      category_position: 0,
      title,
      summary: null,
      has_video: slug === "b",
    });
    const groups = groupHelpArticles([row("a", "x", "A"), row("b", "x", "B"), row("c", "y", "C")]);
    expect(groups.map((g) => [g.id, g.articles.map((a) => a.slug)])).toEqual([
      ["x", ["a", "b"]],
      ["y", ["c"]],
    ]);
    expect(groups[0].articles[1].hasVideo).toBe(true);
    expect(groups[0].description).toBe("");
  });
});
