import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { AssessmentDialog } from "./AssessmentDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBodyAssessments, useDeleteAssessment } from "@/hooks/useBodyAssessments";
import { assessmentErrorMessage } from "@/lib/api/assessments";
import { MEASURE_FIELDS, methodLabel } from "@/lib/domain/anthropometry";
import { formatDate, formatWeight } from "@/lib/domain/format";
import type { BodyAssessment } from "@/types/db";

function measuresSummary(a: BodyAssessment): string {
  const m = a.measurements ?? {};
  const parts = MEASURE_FIELDS.filter((f) => typeof m[f.key] === "number" || (typeof m[f.key] === "string" && m[f.key] !== "")).map((f) => `${f.label} ${m[f.key]}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Avaliações antropométricas lançadas (inclusive antigas): adicionar, editar e excluir. */
export function AssessmentsSection({ patientId }: { patientId: string }) {
  const { data } = useBodyAssessments(patientId);
  const del = useDeleteAssessment(patientId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BodyAssessment | null>(null);
  const [toDelete, setToDelete] = useState<BodyAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mais recente primeiro. Documentos de bioimpedância (sem dados) também são avaliações: mostra só as com dado.
  const list = [...(data ?? [])]
    .filter((a) => a.weight != null || a.body_fat_pct != null || Object.keys(a.measurements ?? {}).length > 0)
    .sort((a, b) => String(b.assessed_at ?? "").localeCompare(String(a.assessed_at ?? "")));

  async function confirmDelete() {
    if (!toDelete) return;
    setError(null);
    try {
      await del.mutateAsync(toDelete.id);
      setToDelete(null);
    } catch (err) {
      setError(assessmentErrorMessage(err));
      setToDelete(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Avaliações registradas</CardTitle>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Adicionar avaliação
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma avaliação lançada. Adicione medidas atuais ou antigas do paciente, com a data em que foram tiradas.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Data</th>
                    <th className="py-2 pr-3 font-medium">Método</th>
                    <th className="py-2 pr-3 text-right font-medium">Peso</th>
                    <th className="py-2 pr-3 text-right font-medium">% Gordura</th>
                    <th className="py-2 pr-3 font-medium">Circunferências (cm)</th>
                    <th className="py-2 text-right font-medium">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => {
                    const when = a.assessed_at ? formatDate(a.assessed_at) : "—";
                    return (
                      <tr key={a.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap">{when}</td>
                        <td className="py-2 pr-3">{methodLabel(a.method)}</td>
                        <td className="py-2 pr-3 text-right">{a.weight != null ? formatWeight(Number(a.weight)) : "—"}</td>
                        <td className="py-2 pr-3 text-right">{a.body_fat_pct != null ? `${a.body_fat_pct}%` : "—"}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{measuresSummary(a)}</td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Editar avaliação de ${when}`}
                            onClick={() => {
                              setEditing(a);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Excluir avaliação de ${when}`} onClick={() => setToDelete(a)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AssessmentDialog patientId={patientId} open={dialogOpen} onOpenChange={setDialogOpen} assessment={editing} />

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => (o ? null : setToDelete(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta avaliação?</AlertDialogTitle>
            <AlertDialogDescription>
              A avaliação de {toDelete?.assessed_at ? formatDate(toDelete.assessed_at) : "—"} sai do gráfico e dos relatórios. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
