import { useState, type DragEvent } from "react";

import { Badge } from "@/components/ui/badge";
import type { JourneyColumn } from "@/lib/domain/journeyBoard";
import { cn } from "@/lib/utils";
import type { PatientListItem } from "@/types/db";

import { JourneyCard, JOURNEY_DND_MIME } from "./JourneyCard";

interface JourneyColumnViewProps {
  column: JourneyColumn;
  patients: PatientListItem[];
  allColumns: JourneyColumn[];
  today: Date;
  isAcked: (patientId: string, key: string) => boolean;
  onMove: (patientId: string, toColumnId: string) => void;
  onAck: (patientId: string, key: string) => void;
  onDropPatient: (patientId: string, toColumnId: string) => void;
  onDragStateChange: (patientId: string | null) => void;
  movingPatientId: string | null;
}

export function JourneyColumnView({
  column,
  patients,
  allColumns,
  today,
  isAcked,
  onMove,
  onAck,
  onDropPatient,
  onDragStateChange,
  movingPatientId,
}: JourneyColumnViewProps) {
  const [isOver, setIsOver] = useState(false);

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    // Só aceita o nosso tipo de arrasto (cartão de paciente).
    if (e.dataTransfer.types.includes(JOURNEY_DND_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!isOver) setIsOver(true);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsOver(false);
    const patientId = e.dataTransfer.getData(JOURNEY_DND_MIME) || e.dataTransfer.getData("text/plain");
    if (patientId) onDropPatient(patientId, column.id);
  }

  return (
    <section
      aria-label={`Coluna ${column.name} (${patients.length})`}
      className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40"
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full border"
          style={{ backgroundColor: column.color ?? "transparent" }}
          aria-hidden
        />
        <h2 className="truncate text-sm font-semibold text-foreground">{column.name}</h2>
        {column.is_initial ? (
          <Badge tone="muted" className="px-1.5 py-0 text-[10px]">
            inicial
          </Badge>
        ) : null}
        <Badge tone="muted" className="ml-auto tabular-nums" aria-hidden>
          {patients.length}
        </Badge>
      </header>

      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={() => setIsOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-lg border-2 border-dashed border-transparent p-2 transition-colors",
          isOver && "border-primary/50 bg-primary/5",
        )}
      >
        {patients.length === 0 ? (
          <p className="m-auto px-2 py-6 text-center text-xs text-muted-foreground">
            Nenhum paciente nesta etapa. Arraste um cartão até aqui.
          </p>
        ) : (
          patients.map((p) => (
            <JourneyCard
              key={p.id}
              patient={p}
              columns={allColumns}
              currentColumnId={column.id}
              today={today}
              isAcked={isAcked}
              onMove={onMove}
              onAck={onAck}
              onDragStateChange={onDragStateChange}
              moving={movingPatientId === p.id}
            />
          ))
        )}
      </div>
    </section>
  );
}
