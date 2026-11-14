// Documentos clínicos da clínica (Entrega 9). Recepção: lista e Reenviar (sem conteúdo). Profissional: só os dos seus pacientes. Financeiro e Estoquista não chegam aqui.
import { DemoBanner } from "@/components/documents/DemoBanner";
import { DocumentsList } from "@/components/documents/DocumentsList";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/feedback/LoadingState";
import { useDocContext } from "@/hooks/useClinicalDocs";
import { NoAccess } from "@/pages/finance/NoAccess";

export function DocumentsPage() {
  const { access, isLoading } = useDocContext();
  if (isLoading) return <LoadingState />;
  if (!access.can_list) return <NoAccess text="Você não tem acesso aos documentos clínicos. Peça ao administrador da clínica." />;
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader title="Documentos" description={access.kind === "front" ? "Documentos já assinados. Você pode reenviar; o conteúdo clínico não aparece para a Recepção." : "Receitas, atestados, exames e relatórios assinados."} />
      {access.is_demo ? <DemoBanner /> : null}
      <DocumentsList filter={{}} showPatient emptyText="Nenhum documento assinado ainda." />
    </div>
  );
}
