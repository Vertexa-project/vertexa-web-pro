import { useState } from "react";
import { FilePlus2 } from "lucide-react";

import { DocumentDialog } from "@/components/documents/DocumentDialog";
import { Button } from "@/components/ui/button";
import { useDocContext } from "@/hooks/useClinicalDocs";

/** «Novo documento» (Receita · Atestado · Exames · Relatório). Só aparece para quem tem acesso clínico; sem registro/conselho o botão fica desabilitado e explica por quê. */
export function NewDocumentButton({ patientId, patientName, encounterId, appointmentId, variant = "outline" }: {
  patientId: string; patientName?: string; encounterId?: string | null; appointmentId?: string | null; variant?: "default" | "outline";
}) {
  const { clinicId, access } = useDocContext();
  const [open, setOpen] = useState(false);
  if (!clinicId || access.kind !== "clinical") return null;
  const why = access.registry_missing ? "Cadastre seu conselho/registro no perfil para emitir documentos." : !access.provider_ready ? "O provedor de prescrição desta clínica ainda não está conectado." : !access.can_emit ? "Só profissional com conselho/registro cadastrado emite documentos." : undefined;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} disabled={!access.can_emit} title={why} aria-describedby={why ? "novo-doc-motivo" : undefined}>
        <FilePlus2 className="h-4 w-4" aria-hidden /> Novo documento
      </Button>
      {why ? <span id="novo-doc-motivo" className="sr-only">{why}</span> : null}
      {open ? <DocumentDialog target={{ clinicId, patientId, patientName, encounterId, appointmentId, providerId: access.provider }} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
