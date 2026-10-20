import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProfessionalRoster, useTransferPatients } from "@/hooks/useManagement";
import { idleLabel, transferSummary, validateTransfer, type ProfessionalLoad } from "@/lib/domain/management";

interface Props {
  clinicId: string;
  professionals: ProfessionalLoad[];
  fromId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/** Transfere pacientes de um profissional para outro (só administrador). Pede confirmação antes. */
export function TransferDialog({ clinicId, professionals, fromId, open, onOpenChange }: Props) {
  const [from, setFrom] = useState<string | null>(fromId);
  const [to, setTo] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const roster = useProfessionalRoster(clinicId, open ? from : null);
  const transfer = useTransferPatients();
  const patients = roster.data ?? [];

  useEffect(() => {
    if (!open) return;
    setFrom(fromId); setTo(null); setSelected(new Set()); setReason(""); setConfirming(false); setError(null); setDone(null);
  }, [open, fromId]);
  useEffect(() => { setSelected(new Set()); setConfirming(false); }, [from]);

  const fromName = professionals.find((p) => p.professional_id === from)?.name ?? "";
  const toName = professionals.find((p) => p.professional_id === to)?.name ?? "";
  const allSelected = patients.length > 0 && selected.size === patients.length;
  const toOptions = useMemo(() => professionals.filter((p) => p.professional_id !== from), [professionals, from]);

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function review() {
    const v = validateTransfer(from, to, selected.size);
    if (!v.ok) return setError(v.error);
    setError(null); setConfirming(true);
  }

  function confirm() {
    if (!from || !to) return;
    transfer.mutate({ fromId: from, toId: to, patientIds: allSelected ? null : [...selected], reason: reason.trim() || undefined }, {
      onSuccess: (r) => setDone(transferSummary(r.moved, r.skipped)),
      onError: () => { setConfirming(false); setError("Não foi possível transferir. Nada foi alterado; tente de novo."); },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Transferir pacientes</DialogTitle>
          <DialogDescription>O profissional de origem deixa de atender os pacientes escolhidos e o de destino passa a atendê-los. O histórico fica registrado.</DialogDescription>
        </DialogHeader>
        {done ? (
          <DialogBody><p className="text-sm text-foreground" role="status">{done}</p></DialogBody>
        ) : (
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="tr-from">De</Label>
                <select id="tr-from" value={from ?? ""} onChange={(e) => setFrom(e.target.value || null)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Escolha…</option>
                  {professionals.map((p) => <option key={p.professional_id} value={p.professional_id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tr-to">Para</Label>
                <select id="tr-to" value={to ?? ""} onChange={(e) => { setTo(e.target.value || null); setConfirming(false); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Escolha…</option>
                  {toOptions.map((p) => <option key={p.professional_id} value={p.professional_id}>{p.name}</option>)}
                </select>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">Pacientes de {fromName || "…"}</legend>
              {!from ? <p className="text-sm text-muted-foreground">Escolha o profissional de origem.</p>
                : roster.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p>
                : patients.length === 0 ? <p className="text-sm text-muted-foreground">Este profissional não tem pacientes ativos.</p>
                : (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(patients.map((p) => p.patient_id)))} />
                      Selecionar todos ({patients.length})
                    </label>
                    <ul className="max-h-48 space-y-1 overflow-auto rounded-md border border-border p-2">
                      {patients.map((p) => (
                        <li key={p.patient_id}>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={selected.has(p.patient_id)} onChange={() => toggle(p.patient_id)} aria-label={p.full_name ?? "Sem nome"} />
                            <span className="flex-1">{p.full_name ?? "Sem nome"}</span>
                            {p.idle_days >= 7 ? <span className="text-xs text-muted-foreground">sem registro há {idleLabel(p.idle_days)}</span> : null}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="tr-reason">Motivo (opcional)</Label>
              <Input id="tr-reason" maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: mudança de agenda" />
            </div>
            {confirming ? (
              <p className="rounded-md bg-warning/10 p-3 text-sm text-foreground" role="alert">
                Transferir {selected.size === 1 ? "1 paciente" : `${selected.size} pacientes`} de {fromName} para {toName}?
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          </DialogBody>
        )}
        <DialogFooter>
          {done ? <Button onClick={() => onOpenChange(false)}>Fechar</Button> : (
            <>
              <Button variant="outline" onClick={() => (confirming ? setConfirming(false) : onOpenChange(false))} disabled={transfer.isPending}>{confirming ? "Voltar" : "Cancelar"}</Button>
              {confirming ? (
                <Button onClick={confirm} disabled={transfer.isPending} aria-busy={transfer.isPending}>
                  {transfer.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Transferir agora
                </Button>
              ) : <Button onClick={review}>Revisar e transferir</Button>}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
