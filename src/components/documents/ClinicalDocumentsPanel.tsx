import { NewDocumentButton } from "@/components/documents/NewDocumentButton";
import { DocumentsList } from "@/components/documents/DocumentsList";
import { PrescribedItemsCard } from "@/components/documents/PrescribedItemsCard";
import { useDocContext } from "@/hooks/useClinicalDocs";

/** Seção «Documentos clínicos» (paciente, atendimento da consulta ou atendimento do financeiro). Some para quem não tem acesso (Financeiro, Estoquista). */
export function ClinicalDocumentsPanel({ patientId, patientName, encounterId, appointmentId, heading = "Documentos clínicos" }: {
  patientId: string; patientName?: string; encounterId?: string | null; appointmentId?: string | null; heading?: string;
}) {
  const { access } = useDocContext();
  if (!access.can_list) return null;
  return (
    <section className="min-w-0 space-y-3" aria-label={heading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <NewDocumentButton patientId={patientId} patientName={patientName} encounterId={encounterId} appointmentId={appointmentId} />
      </div>
      <DocumentsList filter={{ patientId, encounterId, appointmentId }} />
      <PrescribedItemsCard patientId={patientId} encounterId={encounterId} appointmentId={appointmentId} />
    </section>
  );
}
