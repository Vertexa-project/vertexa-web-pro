import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import { CheckField, FormDialog, Field } from "@/components/fin/FinUi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetStaffRoles, useStaffRoles, useUnits } from "@/hooks/useFin";
import type { StaffRoleRow } from "@/lib/api/finRegistry";
import { FIN_ROLE_HINT, FIN_ROLE_LABEL, FIN_ROLES, type FinRole } from "@/lib/domain/finAccess";

interface Draft { enabled: boolean; allUnits: boolean; unitIds: string[] }

function RolesForm({ clinicId, professionalId, name, current, onClose }: { clinicId: string; professionalId: string; name: string; current: StaffRoleRow[]; onClose: () => void }) {
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const save = useSetStaffRoles(clinicId);
  const [draft, setDraft] = useState<Record<FinRole, Draft>>(() =>
    Object.fromEntries(FIN_ROLES.map((r) => {
      const row = current.find((c) => c.role === r);
      return [r, { enabled: Boolean(row), allUnits: row?.all_units ?? true, unitIds: row?.unit_ids ?? [] }];
    })) as Record<FinRole, Draft>,
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const patch = (r: FinRole, p: Partial<Draft>) => setDraft((cur) => ({ ...cur, [r]: { ...cur[r], ...p } }));

  function submit() {
    const bad = FIN_ROLES.find((r) => draft[r].enabled && !draft[r].allUnits && draft[r].unitIds.length === 0);
    if (bad) return setError(`Escolha ao menos uma unidade para ${FIN_ROLE_LABEL[bad]} ou marque «Todas as unidades».`);
    setError(null);
    save.mutate({
      professionalId, reason: reason.trim() || undefined,
      roles: FIN_ROLES.filter((r) => draft[r].enabled).map((r) => ({ role: r, allUnits: draft[r].allUnits, unitIds: draft[r].unitIds })),
    }, { onSuccess: onClose, onError: () => setError("Não foi possível salvar agora. Só o administrador altera papéis.") });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={`Papéis de ${name}`} description="Todo profissional ativo já é «Profissional». Aqui você acrescenta papéis do financeiro e do estoque, por unidade." onSubmit={submit} pending={save.isPending} error={error}>
      {FIN_ROLES.map((r) => (
        <div key={r} className="space-y-2 rounded-md border p-3">
          <CheckField id={`role-${r}`} label={FIN_ROLE_LABEL[r]} checked={draft[r].enabled} onChange={(v) => patch(r, { enabled: v })} hint={FIN_ROLE_HINT[r]} />
          {draft[r].enabled ? (
            <div className="ml-6 space-y-2">
              <CheckField id={`role-${r}-all`} label="Todas as unidades" checked={draft[r].allUnits} onChange={(v) => patch(r, { allUnits: v })} />
              {!draft[r].allUnits ? (
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {units.map((u) => (
                    <CheckField key={u.id} id={`role-${r}-u-${u.id}`} label={u.name} checked={draft[r].unitIds.includes(u.id)} onChange={(v) => patch(r, { unitIds: v ? [...draft[r].unitIds, u.id] : draft[r].unitIds.filter((x) => x !== u.id) })} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      <Field label="Motivo (opcional)" htmlFor="roles-reason" hint="Fica registrado no Histórico."><Input id="roles-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
    </FormDialog>
  );
}

/** Papéis financeiros do membro, com botão para o admin atribuir/retirar (Equipe). */
export function StaffRolesCell({ clinicId, professionalId, name, canEdit }: { clinicId: string; professionalId: string; name: string; canEdit: boolean }) {
  const roles = useStaffRoles(clinicId);
  const [open, setOpen] = useState(false);
  const mine = (roles.data ?? []).filter((r) => r.professional_id === professionalId);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {mine.length === 0 ? <span className="text-xs text-muted-foreground">Sem papel adicional</span> : mine.map((r) => (
        <Badge key={r.id} tone="info">{FIN_ROLE_LABEL[r.role]}{r.all_units ? "" : ` · ${r.unit_ids.length} un.`}</Badge>
      ))}
      {canEdit ? <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setOpen(true)} aria-label={`Papéis financeiros de ${name}`}>Papéis</Button> : null}
      {open ? <RolesForm clinicId={clinicId} professionalId={professionalId} name={name} current={mine} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
