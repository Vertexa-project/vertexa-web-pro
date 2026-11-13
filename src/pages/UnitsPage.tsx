import { useState } from "react";
import { Building2, Plus } from "lucide-react";

import { ActiveBadge, CheckField, ExportButtons, Field, FormDialog, ReasonField, TableShell, Td, Th } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinContext, useSaveUnit, useUnits } from "@/hooks/useFin";
import type { ClinicUnit } from "@/lib/api/finRegistry";
import { finCan } from "@/lib/domain/finAccess";
import { licenseState, type LicenseState } from "@/lib/domain/licenseState";
import { formatDate } from "@/lib/domain/format";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";

const LICENSE_BADGE: Record<LicenseState, { tone: "muted" | "success" | "warning" | "destructive"; text: string }> = {
  none: { tone: "muted", text: "Sem licença" },
  valid: { tone: "success", text: "Válida" },
  expiring: { tone: "warning", text: "Vence em breve" },
  expired: { tone: "destructive", text: "Vencida" },
};

const columns: ExportColumn<ClinicUnit>[] = [
  { header: "Unidade", value: (u) => u.name },
  { header: "Principal", value: (u) => u.is_primary },
  { header: "Ativa", value: (u) => u.is_active },
  { header: "Licença sanitária", value: (u) => u.license_number },
  { header: "Validade da licença", value: (u) => u.license_valid_until },
];

function UnitDialog({ clinicId, unit, onClose }: { clinicId: string; unit: ClinicUnit | "new" | null; onClose: () => void }) {
  const editing = unit && unit !== "new" ? unit : null;
  const save = useSaveUnit(clinicId);
  const [name, setName] = useState(editing?.name ?? "");
  const [license, setLicense] = useState(editing?.license_number ?? "");
  const [validUntil, setValidUntil] = useState(editing?.license_valid_until ?? "");
  const [active, setActive] = useState(editing?.is_active ?? true);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const deactivating = Boolean(editing && editing.is_active && !active);

  function submit() {
    if (!name.trim()) return setError("Informe o nome da unidade.");
    if (deactivating && reason.trim().length < 3) return setError("Informe o motivo da desativação.");
    setError(null);
    save.mutate(
      { id: editing?.id ?? null, name: name.trim(), isActive: active, licenseNumber: license.trim(), licenseValidUntil: validUntil, reason: reason.trim() || undefined },
      {
        onSuccess: onClose,
        onError: (e) => {
          const m = (e as { message?: string }).message ?? "";
          setError(m.includes("PRIMARY_UNIT") ? "A unidade principal não pode ser desativada." : m.includes("duplicate") ? "Já existe uma unidade com esse nome." : "Não foi possível salvar agora. Tente novamente.");
        },
      },
    );
  }

  return (
    <FormDialog open={unit !== null} onOpenChange={(o) => (!o ? onClose() : undefined)} title={editing ? "Editar unidade" : "Nova unidade"} onSubmit={submit} pending={save.isPending} error={error}>
      <Field label="Nome da unidade" htmlFor="unit-name"><Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus /></Field>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Licença sanitária (número)" htmlFor="unit-license"><Input id="unit-license" value={license} onChange={(e) => setLicense(e.target.value)} maxLength={60} /></Field>
        <Field label="Validade da licença" htmlFor="unit-valid"><Input id="unit-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
      </div>
      <p className="text-xs text-muted-foreground">A licença é consultada na venda de manipulado: sem licença válida, o sistema avisa e pede o aceite do administrador.</p>
      {editing && !editing.is_primary ? <CheckField id="unit-active" label="Unidade ativa" checked={active} onChange={setActive} /> : null}
      {editing?.is_primary ? <p className="text-xs text-muted-foreground">Esta é a unidade principal: pode ser renomeada, mas não desativada.</p> : null}
      {editing ? <ReasonField value={reason} onChange={setReason} required={deactivating} /> : null}
    </FormDialog>
  );
}

/** Configurações › Unidades (só o administrador cria, renomeia e desativa; a principal não desativa). */
export function UnitsPage() {
  const { clinicId, access, isLoading } = useFinContext();
  const canWrite = finCan(access, "units", "write");
  const units = useUnits(clinicId, finCan(access, "units"));
  const [editing, setEditing] = useState<ClinicUnit | "new" | null>(null);
  const rows = units.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Unidades"
        description="Locais de atendimento da clínica. Cada unidade tem a sua licença sanitária."
        actions={canWrite ? <Button onClick={() => setEditing("new")}><Plus aria-hidden /> Nova unidade</Button> : undefined}
      />
      {isLoading || units.isLoading ? (
        <LoadingState />
      ) : !canWrite && !finCan(access, "units") ? (
        <NoAccess text="Apenas o administrador da clínica gerencia as unidades." />
      ) : units.isError ? (
        <ErrorState onRetry={() => void units.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Building2} title="Nenhuma unidade" description="A unidade principal é criada junto com a clínica." />
      ) : (
        <div className="space-y-3">
          <ExportButtons columns={columns} rows={rows} filename="unidades" sheetName="Unidades" />
          <TableShell label="Unidades da clínica">
            <thead><tr><Th>Unidade</Th><Th>Situação</Th><Th>Licença sanitária</Th><Th>Validade</Th><Th>{canWrite ? "Ações" : ""}</Th></tr></thead>
            <tbody>
              {rows.map((u) => {
                const ls = licenseState(u);
                return (
                  <tr key={u.id}>
                    <Td className="font-medium">{u.name} {u.is_primary ? <Badge tone="primary" className="ml-1">Principal</Badge> : null}</Td>
                    <Td><ActiveBadge active={u.is_active} /></Td>
                    <Td>{u.license_number ?? "—"} <Badge tone={LICENSE_BADGE[ls].tone} className="ml-1">{LICENSE_BADGE[ls].text}</Badge></Td>
                    <Td>{u.license_valid_until ? formatDate(u.license_valid_until) : "—"}</Td>
                    <Td>{canWrite ? <Button size="sm" variant="outline" onClick={() => setEditing(u)} aria-label={`Editar ${u.name}`}>Editar</Button> : null}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        </div>
      )}
      {clinicId && editing ? <UnitDialog key={editing === "new" ? "new" : editing.id} clinicId={clinicId} unit={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
