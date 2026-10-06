import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { AnthropometryTab } from "@/components/patient/AnthropometryTab";
import { DocumentsTab } from "@/components/patient/DocumentsTab";
import { EvolutionTab } from "@/components/patient/EvolutionTab";
import { ExportPatientReportButton } from "@/components/patient/ExportPatientReportButton";
import { NutritionTab } from "@/components/patient/NutritionTab";
import { OverviewTab } from "@/components/patient/OverviewTab";
import { PatientEditDialog } from "@/components/patient/PatientEditDialog";
import { ProfileHeader } from "@/components/patient/ProfileHeader";
import { RecoveryTab } from "@/components/patient/RecoveryTab";
import { SupplementsTab } from "@/components/patient/SupplementsTab";
import { TimelineTab } from "@/components/patient/TimelineTab";
import { WorkoutTab } from "@/components/patient/WorkoutTab";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdherenceSnapshot } from "@/hooks/useAdherenceSnapshot";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { usePatient } from "@/hooks/usePatients";

const TABS = [
  { value: "overview", label: "Visão geral" },
  { value: "timeline", label: "Timeline" },
  { value: "anthropometry", label: "Antropometria" },
  { value: "evolution", label: "Evolução/Fotos" },
  { value: "documents", label: "Documentos" },
  { value: "nutrition", label: "Plano alimentar" },
  { value: "supplements", label: "Suplementos" },
  { value: "workout", label: "Treino" },
  { value: "recovery", label: "Recuperação" },
];

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-10 w-full max-w-xl" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function PatientProfilePage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [tab, setTab] = useState("overview");

  const [editOpen, setEditOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const patientQ = usePatient(id);
  const snapshotQ = useAdherenceSnapshot(id);
  // Admin da clínica DO PACIENTE (sinal real do banco, fail-closed). O servidor é a autoridade.
  const { isClinicAdmin } = useIsClinicAdmin(patientQ.data?.clinic_id ?? null);

  useEffect(() => {
    if (!savedNotice) return;
    const t = setTimeout(() => setSavedNotice(false), 4000);
    return () => clearTimeout(t);
  }, [savedNotice]);

  if (patientQ.isLoading || snapshotQ.isLoading) return <ProfileSkeleton />;

  if (patientQ.isError || !patientQ.data) {
    return (
      <ErrorState
        title="Paciente não encontrado"
        description="O paciente não existe ou não pôde ser carregado."
        onRetry={() => navigate("/pacientes")}
      />
    );
  }

  // O VRI/adesão vem de uma query própria — se ela falhar, mostramos erro com
  // retry em vez de degradar em silêncio (VRI "—" + "Sinais recentes" vazio).
  if (snapshotQ.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar a adesão (VRI)"
        description="Os indicadores deste paciente não puderam ser carregados. Tente novamente."
        onRetry={() => snapshotQ.refetch()}
      />
    );
  }

  const patient = patientQ.data;
  const snapshot = snapshotQ.data ?? null;

  return (
    <div className="space-y-6">
      <ProfileHeader patient={patient} snapshot={snapshot} />

      <div className="flex items-center justify-end gap-3">
        {savedNotice ? (
          <p role="status" className="text-sm text-muted-foreground">
            Cadastro atualizado.
          </p>
        ) : null}
        {isClinicAdmin ? (
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            Editar cadastro
          </Button>
        ) : null}
        <ExportPatientReportButton patientId={patient.id} />
      </div>

      {isClinicAdmin ? (
        <PatientEditDialog
          patient={patient}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => setSavedNotice(true)}
        />
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview">
          <OverviewTab patient={patient} snapshot={snapshot} onGoToTab={setTab} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="anthropometry">
          <AnthropometryTab patient={patient} />
        </TabsContent>
        <TabsContent value="evolution">
          <EvolutionTab patient={patient} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="nutrition">
          <NutritionTab patient={patient} />
        </TabsContent>
        <TabsContent value="supplements">
          <SupplementsTab patient={patient} />
        </TabsContent>
        <TabsContent value="workout">
          <WorkoutTab patient={patient} />
        </TabsContent>
        <TabsContent value="recovery">
          <RecoveryTab patientId={patient.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
