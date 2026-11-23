import { useQuery } from "@tanstack/react-query";

import {
  getHelpArticle,
  getHelpCenterAccess,
  listHelpCategories,
  searchHelpArticles,
} from "@/lib/api/helpCenter";

export const helpKeys = {
  access: ["help-center", "access"] as const,
  categories: ["help-center", "categories"] as const,
  article: (slug: string) => ["help-center", "article", slug] as const,
  search: (q: string) => ["help-center", "search", q] as const,
};

export function useHelpCenterAccess(enabled = true) {
  return useQuery({
    queryKey: helpKeys.access,
    queryFn: getHelpCenterAccess,
    enabled,
    staleTime: 60_000,
  });
}

export function useHelpCategories(enabled = true) {
  return useQuery({
    queryKey: helpKeys.categories,
    queryFn: listHelpCategories,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useHelpArticle(slug: string | undefined) {
  return useQuery({
    queryKey: helpKeys.article(slug ?? ""),
    queryFn: () => getHelpArticle(slug ?? ""),
    enabled: Boolean(slug),
    staleTime: 5 * 60_000,
  });
}

export function useHelpSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: helpKeys.search(q.toLowerCase()),
    queryFn: () => searchHelpArticles(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
}
