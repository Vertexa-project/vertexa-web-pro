import { useId, useMemo, useState } from "react";

import { ExerciseMedia } from "@/components/exercise/ExerciseMedia";
import { Input } from "@/components/ui/input";
import { searchExercises, type ExerciseLibraryItem } from "@/lib/domain/exerciseLibrary";
import { cn } from "@/lib/utils";

/**
 * Campo do nome do exercício com sugestões da Biblioteca. Acha pelo nome oficial ou pelo nome
 * curto/apelido, sem diferenciar acento ou maiúscula ("supino maquina" acha "Supino sentado na
 * máquina"). O nome continua livre: quem digita algo fora da lista mantém o texto digitado.
 */
export function ExerciseNameInput({
  value,
  items,
  onChange,
  onPick,
}: {
  value: string;
  items: ExerciseLibraryItem[];
  onChange: (name: string) => void;
  onPick: (item: ExerciseLibraryItem) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = useMemo(() => searchExercises(items, value, 8), [items, value]);
  const show = open && suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0].name === value);

  function pick(item: ExerciseLibraryItem) {
    onPick(item);
    setOpen(false);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(suggestions[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Exercício (buscar na Biblioteca)"
        aria-label="Nome do exercício"
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {show ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Sugestões da Biblioteca"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
        >
          {suggestions.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === active}
              // mousedown (não click): escolhe antes do blur fechar a lista; funciona no toque também
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
                i === active ? "bg-accent text-accent-foreground" : "text-foreground",
              )}
            >
              <ExerciseMedia item={item} className="h-8 w-10 shrink-0 rounded" />
              <span className="min-w-0 flex-1 leading-snug">{item.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.groupLabel}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
