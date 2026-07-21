import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Paleta sóbria (tokens de status + neutros) para a cor da coluna — sem inundar de laranja. */
export const COLUMN_PALETTE = [
  "#94A3B8", // slate
  "#3B82F6", // blue
  "#22C55E", // green
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#14B8A6", // teal
  "#F97316", // orange
] as const;

export interface ColumnFormValues {
  name: string;
  color: string | null;
}

interface ColumnFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: ColumnFormValues;
  pending: boolean;
  onSubmit: (values: ColumnFormValues) => void;
}

export function ColumnFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  pending,
  onSubmit,
}: ColumnFormDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(COLUMN_PALETTE[0]);

  // Sincroniza o formulário ao abrir (create = vazio; edit = valores atuais).
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setColor(initial?.color ?? COLUMN_PALETTE[0]);
    }
  }, [open, initial?.name, initial?.color]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !pending;

  function submit() {
    if (!canSave) return;
    onSubmit({ name: trimmed, color });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Nova coluna" : "Editar coluna"}</DialogTitle>
          <DialogDescription>
            Nome e cor da etapa da jornada. A coluna inicial se define na lista.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="column-name">Nome</Label>
            <Input
              id="column-name"
              value={name}
              maxLength={40}
              placeholder="Ex.: Em acompanhamento"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Cor da coluna">
              {COLUMN_PALETTE.map((c) => {
                const active = c.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Cor ${c}`}
                    aria-pressed={active}
                    onClick={() => setColor(c)}
                    className={cn(
                      "h-7 w-7 rounded-full border transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      active ? "ring-2 ring-primary ring-offset-2" : "hover:scale-110",
                    )}
                    style={{ backgroundColor: c }}
                  />
                );
              })}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSave}>
            {mode === "create" ? "Criar coluna" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
