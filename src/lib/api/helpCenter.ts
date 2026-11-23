import { supabase } from "@/lib/supabase";

/** Central de Ajuda (cartão 1317): só para quem assina o Vertexa e para a equipe da plataforma. */

export interface HelpCenterAccess {
  allowed: boolean;
  reason: "ok" | "not_subscribed" | "not_authenticated";
  platformAdmin: boolean;
}

export interface HelpArticleSummary {
  slug: string;
  categoryId: string;
  title: string;
  summary: string;
  hasVideo: boolean;
}

export interface HelpCategory {
  id: string;
  title: string;
  description: string;
  articles: HelpArticleSummary[];
}

export interface HelpArticle {
  slug: string;
  categoryId: string;
  categoryTitle: string;
  title: string;
  summary: string;
  body: string;
  videoPath: string | null;
  updatedAt: string | null;
}

export interface HelpSearchHit {
  slug: string;
  categoryTitle: string;
  title: string;
  summary: string;
}

export function mapHelpCenterAccess(raw: unknown): HelpCenterAccess {
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const reason = rec.reason === "ok" || rec.reason === "not_authenticated" ? rec.reason : "not_subscribed";
  return {
    allowed: rec.allowed === true,
    reason,
    platformAdmin: rec.platform_admin === true,
  };
}

export async function getHelpCenterAccess(): Promise<HelpCenterAccess> {
  const { data, error } = await supabase.rpc("help_center_access");
  if (error) throw error;
  return mapHelpCenterAccess(data);
}

interface ListRow {
  slug: string;
  category_id: string;
  category_title: string;
  category_description: string | null;
  category_position: number | null;
  title: string;
  summary: string | null;
  has_video: boolean | null;
}

/** Agrupa as linhas (já ordenadas pelo servidor) por categoria, mantendo a ordem. */
export function groupHelpArticles(rows: ListRow[]): HelpCategory[] {
  const byId = new Map<string, HelpCategory>();
  for (const row of rows) {
    let cat = byId.get(row.category_id);
    if (!cat) {
      cat = {
        id: row.category_id,
        title: row.category_title,
        description: row.category_description ?? "",
        articles: [],
      };
      byId.set(row.category_id, cat);
    }
    cat.articles.push({
      slug: row.slug,
      categoryId: row.category_id,
      title: row.title,
      summary: row.summary ?? "",
      hasVideo: row.has_video === true,
    });
  }
  return [...byId.values()];
}

export async function listHelpCategories(): Promise<HelpCategory[]> {
  const { data, error } = await supabase.rpc("help_list_articles");
  if (error) throw error;
  return groupHelpArticles((data ?? []) as ListRow[]);
}

interface ArticleRow {
  slug: string;
  category_id: string;
  category_title: string;
  title: string;
  summary: string | null;
  body: string | null;
  video_path: string | null;
  updated_at: string | null;
}

export async function getHelpArticle(slug: string): Promise<HelpArticle | null> {
  const { data, error } = await supabase.rpc("help_get_article", { p_slug: slug });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as ArticleRow | undefined;
  if (!row) return null;
  return {
    slug: row.slug,
    categoryId: row.category_id,
    categoryTitle: row.category_title,
    title: row.title,
    summary: row.summary ?? "",
    body: row.body ?? "",
    videoPath: row.video_path,
    updatedAt: row.updated_at,
  };
}

interface SearchRow {
  slug: string;
  category_title: string;
  title: string;
  summary: string | null;
}

export async function searchHelpArticles(query: string): Promise<HelpSearchHit[]> {
  const { data, error } = await supabase.rpc("help_search_articles", { p_query: query });
  if (error) throw error;
  return ((data ?? []) as SearchRow[]).map((r) => ({
    slug: r.slug,
    categoryTitle: r.category_title,
    title: r.title,
    summary: r.summary ?? "",
  }));
}
