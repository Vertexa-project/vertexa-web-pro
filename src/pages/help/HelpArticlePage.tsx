import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { HelpMarkup } from "@/components/help/HelpMarkup";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { useHelpArticle, useHelpCategories } from "@/hooks/useHelpCenter";

export function HelpArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const article = useHelpArticle(slug);
  const categories = useHelpCategories();

  if (article.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <LoadingState />
      </div>
    );
  }
  if (article.isError || !article.data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center md:px-6">
        <h1 className="text-xl font-semibold">Tutorial não encontrado</h1>
        <p className="mt-2 text-muted-foreground">Ele pode ter sido retirado ou o endereço está incompleto.</p>
        <Button asChild className="mt-5">
          <Link to="/ajuda">Ver todos os tutoriais</Link>
        </Button>
      </div>
    );
  }

  const a = article.data;
  const siblings =
    categories.data?.find((c) => c.id === a.categoryId)?.articles.filter((s) => s.slug !== a.slug) ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-10">
      <nav aria-label="Você está em" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link to="/ajuda" className="hover:text-foreground hover:underline">
          Tutoriais
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link to={`/ajuda#${a.categoryId}`} className="hover:text-foreground hover:underline">
          {a.categoryTitle}
        </Link>
      </nav>

      <article className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm md:p-8">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{a.title}</h1>
        {a.summary ? <p className="mt-2 text-muted-foreground">{a.summary}</p> : null}
        <div className="mt-6">
          <HelpMarkup body={a.body} />
        </div>
      </article>

      {siblings.length > 0 ? (
        <section className="mt-8" aria-labelledby="mais-tutoriais">
          <h2 id="mais-tutoriais" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Mais tutoriais de {a.categoryTitle}
          </h2>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {siblings.map((s) => (
              <li key={s.slug}>
                <Link
                  to={`/ajuda/tutoriais/${s.slug}`}
                  className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1">{s.title}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Button asChild variant="ghost" className="mt-6">
        <Link to="/ajuda">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Todos os tutoriais
        </Link>
      </Button>
    </div>
  );
}
