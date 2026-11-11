import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { AsyncSection } from "@/components/patient/AsyncSection";
import { ExerciseMedia } from "@/components/exercise/ExerciseMedia";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useExerciseLibrary } from "@/hooks/useExerciseLibrary";
import { groupExercises, type ExerciseLibraryItem } from "@/lib/domain/exerciseLibrary";
import { cn } from "@/lib/utils";

/**
 * Biblioteca de exercícios (Oficina #581): o catálogo da Vertexa por grupo, cada exercício com a
 * sua animação. É o mesmo catálogo que o editor de treino sugere e que o app do paciente usa.
 */
export function ExerciseLibraryPage() {
  const { items, isLoading, isError, refetch } = useExerciseLibrary();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("todos");
  const [open, setOpen] = useState<ExerciseLibraryItem | null>(null);

  const allGroups = useMemo(() => groupExercises(items), [items]);
  const groups = useMemo(
    () => groupExercises(items, query).filter((g) => group === "todos" || g.key === group),
    [items, query, group],
  );
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Biblioteca de exercícios"
        description={`${items.length} exercícios com demonstração. Ao montar o treino, escolha o nome da lista para o paciente ver a animação no app.`}
      />

      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar exercício"
            aria-label="Buscar exercício"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Grupos">
          {[{ key: "todos", label: "Todos", count: items.length }, ...allGroups.map((g) => ({ key: g.key, label: g.label, count: g.items.length }))].map(
            (g) => (
              <button
                key={g.key}
                type="button"
                aria-pressed={group === g.key}
                onClick={() => setGroup(g.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  group === g.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-accent",
                )}
              >
                {g.label} <span className="opacity-70">{g.count}</span>
              </button>
            ),
          )}
        </div>
      </div>

      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        isEmpty={!isLoading && shown === 0}
        onRetry={() => refetch()}
        emptyIcon={Search}
        emptyTitle="Nenhum exercício encontrado"
        emptyDescription="Tente outro nome ou escolha outro grupo."
      >
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`grupo-${g.key}`} className="space-y-3">
              <h2 id={`grupo-${g.key}`} className="text-base font-semibold text-foreground">
                {g.label} <span className="text-sm font-normal text-muted-foreground">· {g.items.length}</span>
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {g.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(item)}
                      className="group w-full overflow-hidden rounded-xl border bg-card text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={`exercicio-${item.id}`}
                    >
                      <ExerciseMedia item={item} className="aspect-[4/3] w-full" />
                      <span className="block px-3 py-2 text-sm font-medium leading-snug text-foreground">{item.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </AsyncSection>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent>
          {open ? (
            <>
              <DialogHeader>
                <DialogTitle>{open.name}</DialogTitle>
                <DialogDescription>{open.groupLabel}</DialogDescription>
              </DialogHeader>
              <DialogBody>
                <ExerciseMedia item={open} lazy={false} className="aspect-[4/3] w-full rounded-lg" />
              </DialogBody>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
