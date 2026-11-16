import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { NewDocumentButton } from "@/components/documents/NewDocumentButton";
import { StartEncounterButton } from "@/components/clinical/StartEncounterButton";
import { ClinicalRecordTab } from "@/components/patient/ClinicalRecordTab";
import { AnthropometryTab } from "@/components/patient/AnthropometryTab";
import { DocumentsTab } from "@/components/patient/DocumentsTab";
import { EvolutionTab } from "@/components/patient/EvolutionTab";
import { NewAppointmentButton } from "@/components/fin/NewAppointmentButton";
import { NewSaleButton } from "@/components/fin/NewSaleButton";
import { PatientPackagesCard } from "@/components/fin/PatientPackagesCard";
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
import { PATIENT_TABS, resolvePatientTab, type PatientSubId, type PatientTabId } from "@/lib/domain/patientTabs";
import { qk } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

/** Sub-abas (Radix Tabs: setas/Home/End/foco); quebram de linha no celular em vez de empurrar a página. */
function SubTabs({
  tab,
  value,
  onChange,
  label,
  children,
}: {
  tab: PatientTabId;
  value: PatientSubId | null;
  onChange: (sub: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  const subs = PATIENT_TABS.find((t) => t.id === tab)?.subs ?? [];
  return (
    <Tabs value={value ?? subs[0]?.id} onValueChange={onChange}>
      <TabsList aria-label={`Sub-abas de ${label}`} className="h-auto max-w-full flex-wrap justify-start gap-0.5 rounded-[10px] bg-muted p-[3px]">
        {subs.map((s) => (
          <TabsTrigger
            key={s.id}
            value={s.id}
            className={cn("rounded-lg px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:font-semibold")}
          >
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}

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
  // Aba/sub-aba vêm de ?tab= / ?sub= (valores antigos ou novos) e são espelhadas na URL (replace: não polui o histórico).
  const [searchParams, setSearchParams] = useSearchParams();
  const { tab, sub } = resolvePatientTab(searchParams.get("tab"), searchParams.get("sub"));
  const goTo = (nextTab: string, nextSub?: string | null) => {
    const next = resolvePatientTab(nextTab, nextSub);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", next.tab);
        if (next.sub) p.set("sub", next.sub);
        else p.delete("sub");
        return p;
      },
      { replace: true },
    );
  };

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

  // Cadastro excluído nesta ficha: o cache ["patient", id, ...] só é descartado DEPOIS que a ficha
  // desmonta (fim da transição de navegação). Antes disso os dados continuam no cache, então o
  // re-render final não dispara nenhuma busca pelo paciente que já não existe.
  const qc = useQueryClient();
  const deletedRef = useRef(false);
  useEffect(
    () => () => {
      if (deletedRef.current) qc.removeQueries({ queryKey: qk.patient(id) });
    },
    [qc, id],
  );

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

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
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
        <StartEncounterButton patientId={patient.id} variant="outline" />
        <NewAppointmentButton patientId={patient.id} patientName={patient.profile?.full_name ?? "Paciente"} />
        <NewDocumentButton patientId={patient.id} patientName={patient.profile?.full_name ?? "Paciente"} />
        <NewSaleButton patientId={patient.id} patientName={patient.profile?.full_name ?? "Paciente"} />
        <ExportPatientReportButton patientId={patient.id} />
      </div>

      <PatientPackagesCard patientId={patient.id} />

      {isClinicAdmin ? (
        <PatientEditDialog
          patient={patient}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => setSavedNotice(true)}
          onDeleted={() => {
            deletedRef.current = true;
            navigate("/pacientes", { state: { notice: "Cadastro excluído." } });
          }}
        />
      ) : null}

      <Tabs value={tab} onValueChange={(v) => goTo(v)}>
        <div className="relative overflow-x-auto border-b border-border">
          <TabsList className="h-auto w-max gap-1 rounded-none bg-transparent p-0">
            {PATIENT_TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="-mb-px rounded-none border-b-2 border-transparent px-[13px] py-2 text-muted-foreground data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="resumo">
          {/* O Resumo abre outras abas pelos valores antigos (workout, nutrition…): goTo mapeia para aba + sub-aba. */}
          <OverviewTab patient={patient} snapshot={snapshot} onGoToTab={(v) => goTo(v)} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="prontuario">
          <ClinicalRecordTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="planos">
          <SubTabs tab="planos" value={sub} onChange={(v) => goTo("planos", v)} label="Planos">
            <TabsContent value="alimentar">
              <NutritionTab patient={patient} />
            </TabsContent>
            <TabsContent value="suplementos">
              <SupplementsTab patient={patient} />
            </TabsContent>
            <TabsContent value="treino">
              <WorkoutTab patient={patient} />
            </TabsContent>
          </SubTabs>
        </TabsContent>
        <TabsContent value="evolucao">
          <SubTabs tab="evolucao" value={sub} onChange={(v) => goTo("evolucao", v)} label="Evolução">
            <TabsContent value="antropometria">
              <AnthropometryTab patient={patient} />
            </TabsContent>
            <TabsContent value="fotos">
              <EvolutionTab patient={patient} />
            </TabsContent>
            <TabsContent value="recuperacao">
              <RecoveryTab patientId={patient.id} />
            </TabsContent>
          </SubTabs>
        </TabsContent>
        <TabsContent value="documentos">
          <DocumentsTab patientId={patient.id} patientName={patient.profile?.full_name ?? "Paciente"} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
