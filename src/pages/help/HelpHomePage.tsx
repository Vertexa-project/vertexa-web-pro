import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, ChevronRight, PlayCircle, Search } from "lucide-react";

import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHelpCategories, useHelpSearch } from "@/hooks/useHelpCenter";

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SearchResults({ query }: { query: string }) {
  const search = useHelpSearch(query);
  if (query.trim().length < 2) return null;
  if (search.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <LoadingState />
      </div>
    );
  }
  if (search.isError) {
    return <p className="py-6 text-sm text-destructive">Não foi possível buscar agora. Tente de novo.</p>;
  }
  const hits = search.data ?? [];
  return (
    <section aria-label="Resultados da busca" className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {hits.length === 0
          ? `Nenhum tutorial encontrado para "${query.trim()}". Tente outra palavra.`
          : `${hits.length} ${hits.length === 1 ? "tutorial encontrado" : "tutoriais encontrados"}`}
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {hits.map((hit) => (
          <li key={hit.slug}>
            <Link
              to={`/ajuda/tutoriais/${hit.slug}`}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium uppercase tracking-wide text-primary">{hit.categoryTitle}</span>
                <span className="block font-medium">{hit.title}</span>
                {hit.summary ? <span className="block text-sm text-muted-foreground">{hit.summary}</span> : null}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HelpHomePage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const debounced = useDebounced(query, 250);
  const categories = useHelpCategories();

  useEffect(() => {
    const q = debounced.trim();
    setParams(q ? { q } : {}, { replace: true });
  }, [debounced, setParams]);

  const searching = debounced.trim().length >= 2;
  const total = (categories.data ?? []).reduce((n, c) => n + c.articles.length, 0);

  return (
    <div>
      <section className="border-b border-border/70 bg-gradient-to-b from-primary/10 via-background to-background">
        <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-10 md:px-6 md:pt-14">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Como podemos ajudar?</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Tutoriais passo a passo para usar o Vertexa na sua clínica.
          </p>
          <form
            role="search"
            className="relative mt-6 max-w-2xl"
            onSubmit={(e) => e.preventDefault()}
          >
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Buscar nos tutoriais"
              placeholder="Buscar nos tutoriais (ex.: agenda, importar pacientes)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 rounded-xl bg-background pl-11 text-base shadow-sm"
            />
          </form>
          {!searching && categories.data && categories.data.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Assuntos">
              {categories.data.map((c) => (
                <a
                  key={c.id}
                  href={`#${c.id}`}
                  className="rounded-full border border-border bg-background px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {c.title}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
        {searching ? (
          <SearchResults query={debounced} />
        ) : categories.isLoading ? (
          <div className="flex justify-center py-16">
            <LoadingState />
          </div>
        ) : categories.isError ? (
          <div className="py-10 text-center">
            <p className="text-muted-foreground">Não foi possível carregar os tutoriais.</p>
            <Button className="mt-4" variant="outline" onClick={() => void categories.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : total === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Os tutoriais estão sendo preparados e aparecem aqui em breve.</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {(categories.data ?? []).map((cat) => (
              <section
                key={cat.id}
                id={cat.id}
                aria-labelledby={`cat-${cat.id}`}
                className="min-w-0 scroll-mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BookOpen className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 id={`cat-${cat.id}`} className="font-semibold tracking-tight">
                      {cat.title}
                    </h2>
                    {cat.description ? <p className="text-sm text-muted-foreground">{cat.description}</p> : null}
                  </div>
                </div>
                <ul className="mt-4 space-y-0.5">
                  {cat.articles.map((a) => (
                    <li key={a.slug}>
                      <Link
                        to={`/ajuda/tutoriais/${a.slug}`}
                        className="group flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      >
                        {a.hasVideo ? (
                          <PlayCircle className="h-4 w-4 shrink-0 text-primary" aria-label="Tem vídeo" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1">{a.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
