import { useMemo, type DragEvent } from "react";
import { Check, GripVertical, MoveRight } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/domain/format";
import { sortColumns, type JourneyColumn } from "@/lib/domain/journeyBoard";
import { computeMilestones, pickRelevantMilestone } from "@/lib/domain/journeyMilestones";
import { cn } from "@/lib/utils";
import type { PatientListItem } from "@/types/db";

import { MilestoneBadge } from "./MilestoneBadge";

export const JOURNEY_DND_MIME = "application/x-vertexa-patient";

interface JourneyCardProps {
  patient: PatientListItem;
  columns: JourneyColumn[];
  currentColumnId: string | null;
  today: Date;
  isAcked: (patientId: string, key: string) => boolean;
  onMove: (patientId: string, toColumnId: string) => void;
  onAck: (patientId: string, key: string) => void;
  onDragStateChange: (patientId: string | null) => void;
  moving: boolean;
}

export function JourneyCard({
  patient,
  columns,
  currentColumnId,
  today,
  isAcked,
  onMove,
  onAck,
  onDragStateChange,
  moving,
}: JourneyCardProps) {
  const name = patient.profile?.full_name ?? "Paciente";
  const relevant = useMemo(() => {
    const ms = computeMilestones({
      startDate: patient.start_date,
      birthDate: patient.birth_date,
      today,
    });
    return pickRelevantMilestone(ms);
  }, [patient.start_date, patient.birth_date, today]);

  const acked = relevant ? isAcked(patient.id, relevant.key) : false;
  const otherColumns = sortColumns(columns).filter((c) => c.id !== currentColumnId);

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData(JOURNEY_DND_MIME, patient.id);
    e.dataTransfer.setData("text/plain", patient.id);
    e.dataTransfer.effectAllowed = "move";
    onDragStateChange(patient.id);
  }

  return (
    <div
      draggable={!moving}
      onDragStart={handleDragStart}
      onDragEnd={() => onDragStateChange(null)}
      aria-label={`Cartão de ${name}. Arraste ou use o menu Mover para trocar de coluna.`}
      className={cn(
        "group rounded-lg border bg-card p-3.5 shadow-card transition-shadow",
        moving ? "opacity-60" : "cursor-grab hover:shadow-md active:cursor-grabbing",
      )}
    >
      {/* Linha de identidade: pega de arraste + avatar + NOME (prioridade de leitura) + "Mover para". */}
      <div className="flex items-start gap-2">
        <GripVertical
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
          aria-hidden
        />
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
        </Avatar>
        {/* Nome em até 2 linhas (não corta em 1 linha curta como antes); nome completo no title. */}
        <p
          className="line-clamp-2 min-w-0 flex-1 break-words pt-0.5 text-sm font-semibold leading-snug text-foreground"
          title={name}
        >
          {name}
        </p>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={`Mover ${name} para outra coluna`}
              disabled={moving || otherColumns.length === 0}
            >
              <MoveRight className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Mover para</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {otherColumns.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => onMove(patient.id, c.id)}>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border"
                  style={{ backgroundColor: c.color ?? "transparent" }}
                  aria-hidden
                />
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Objetivo/plano em LARGURA TOTAL do cartão (antes dividia a linha com avatar e botão, o que
          o espremia). Até 2 linhas; o texto completo fica no title. */}
      {patient.goal ? (
        <p
          className="mt-2.5 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground"
          title={patient.goal}
        >
          {patient.goal}
        </p>
      ) : null}

      {/* Rodapé de ações, separado do corpo por uma divisória. */}
      {relevant ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5">
          <MilestoneBadge milestone={relevant} acked={acked} />
          {acked ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5" aria-hidden /> Reconhecido
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 shrink-0 px-2.5 text-xs"
              onClick={() => onAck(patient.id, relevant.key)}
            >
              Reconhecer
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
