import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

import { StatusBadge } from "@/components/status/StatusBadge";
import { ProfilePhoto } from "@/components/avatar/ProfilePhoto";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { professionalTypeLabel } from "@/lib/domain/format";
import { statusLabel } from "@/lib/domain/vri";
import { cn } from "@/lib/utils";
import type { AdherenceSnapshot, PatientDetail } from "@/types/db";

interface ProfileHeaderProps {
  patient: PatientDetail;
  snapshot: AdherenceSnapshot | null;
}

export function ProfileHeader({ patient, snapshot }: ProfileHeaderProps) {
  const navigate = useNavigate();
  const name = patient.profile?.full_name ?? "Sem nome";
  const prof = patient.professionals[0];
  const score = snapshot?.score ?? null;
  const atRisk = snapshot?.status === "em_risco" || (score != null && score < 20);
  const vriAria =
    score != null
      ? `Índice de retenção ${score}${snapshot?.status ? `, ${statusLabel(snapshot.status)}` : ""}`
      : "Índice de retenção indisponível";

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
        onClick={() => navigate("/pacientes")}
      >
        <ChevronLeft className="h-4 w-4" />
        Pacientes
      </Button>

      <Card className="p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <ProfilePhoto
              name={name}
              avatarPath={patient.profile?.avatar_path}
              legacyUrl={patient.profile?.avatar_url}
              className="h-16 w-16 text-lg"
            />
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{name}</h1>
              {patient.goal ? <p className="text-sm text-muted-foreground">{patient.goal}</p> : null}
              {prof ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {prof.full_name} · {professionalTypeLabel(prof.type)}
                  {patient.professionals.length > 1 ? ` +${patient.professionals.length - 1}` : ""}
                </p>
              ) : null}
            </div>
          </div>

          <div
            className="flex items-center gap-4 self-start rounded-lg border bg-muted/30 px-5 py-3 sm:self-auto"
            aria-label={vriAria}
          >
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground" aria-hidden>
                VRI
              </p>
              <p
                className={cn(
                  "tnum font-display text-3xl font-bold leading-none",
                  atRisk ? "text-destructive" : "text-foreground",
                )}
                aria-hidden
              >
                {score ?? "—"}
              </p>
            </div>
            <div className="h-10 w-px bg-border" />
            <StatusBadge status={snapshot?.status} score={snapshot?.score} />
          </div>
        </div>
      </Card>
    </div>
  );
}
