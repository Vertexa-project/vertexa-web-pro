import { PackageOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFinContext } from "@/hooks/useFin";
import { usePatientPackages } from "@/hooks/useFinAppointments";
import { canSeeAppointments, canSeePatientPackages } from "@/lib/domain/finAccess";
import { packageState } from "@/lib/domain/finAppointments";
import { formatQty } from "@/lib/domain/stockMoves";

const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Saldo dos pacotes do paciente na ficha: sessões e itens que restam e a validade. Só aparece para quem o servidor deixa ler (pacotes ativos; sem valores para o profissional). */
export function PatientPackagesCard({ patientId }: { patientId: string }) {
  const { clinicId, access } = useFinContext();
  const allowed = canSeePatientPackages(access) || canSeeAppointments(access);
  const q = usePatientPackages(clinicId, { patientId, status: "active" }, allowed);
  const rows = q.data ?? [];
  if (!allowed || q.isLoading || q.isError || rows.length === 0) return null;
  return (
    <Card aria-label="Pacotes do paciente">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><PackageOpen className="h-4 w-4" aria-hidden /> Pacotes do paciente</CardTitle></CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {rows.map((p) => {
          const st = packageState(p);
          return (
            <div key={p.id} className="min-w-0 space-y-1 rounded-md border p-3 text-sm">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <strong className="min-w-0 break-words">{p.name}</strong>
                <Badge tone={st.tone}>{st.label} · vence {br(p.expires_on)}</Badge>
              </div>
              <ul className="min-w-0 space-y-0.5 text-muted-foreground">
                {p.items.map((i) => <li key={i.id} className="break-words">{i.name}: restam {formatQty(i.remaining)} de {formatQty(i.qty_total)} {i.item_type === "service" ? "sessões" : "unidades"}</li>)}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
