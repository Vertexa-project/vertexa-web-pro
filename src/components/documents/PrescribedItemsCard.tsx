// Itens prescritos como dado (10.3.4): base do «Preparar retorno». Quando o item casa com um medicamento do estoque da clínica, mostra a SUGESTÃO; nada é baixado.
import { FinTable } from "@/components/fin/FinUi";
import { Badge } from "@/components/ui/badge";
import { useDocContext, usePrescribedItems } from "@/hooks/useClinicalDocs";
import type { PrescribedRow } from "@/lib/api/clinicalDocs";
import { dateTimeBR } from "@/lib/domain/clinicalDocs";

export function PrescribedItemsCard({ patientId, encounterId, appointmentId }: { patientId: string; encounterId?: string | null; appointmentId?: string | null }) {
  const { clinicId, access } = useDocContext();
  const q = usePrescribedItems(clinicId, patientId, { encounterId, appointmentId }, access.can_content);
  const rows = q.data ?? [];
  if (!access.can_content || rows.length === 0) return null;
  return (
    <section className="min-w-0 space-y-2" aria-label="Itens prescritos">
      <div>
        <h3 className="text-sm font-semibold">Itens prescritos</h3>
        <p className="text-xs text-muted-foreground">Dado para preparar o retorno. A sugestão de estoque é só uma indicação: nenhum estoque é baixado automaticamente.</p>
      </div>
      <FinTable<PrescribedRow>
        label="Itens prescritos" rows={rows} rowKey={(r) => `${r.document_id}-${r.name}-${r.posology}`}
        columns={[
          { header: "Medicamento", role: "title", cell: (r) => r.name },
          { header: "Prescrição", cell: (r) => `${r.dose} — ${r.posology} (${r.quantity})` },
          { header: "Receita de", nowrap: true, cell: (r) => <span>{dateTimeBR(r.signed_at)}{r.is_demo ? <Badge tone="warning" className="ml-1">Demonstração</Badge> : null}</span> },
          { header: "Estoque da clínica", role: "badge", cell: (r) => (r.stock_suggestion ? <Badge tone="success" title="Sugestão: nada é baixado">Sugestão: {r.stock_suggestion.name}</Badge> : <span className="text-xs text-muted-foreground">sem item correspondente</span>) },
        ]}
      />
    </section>
  );
}
