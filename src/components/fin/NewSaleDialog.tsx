// Nova venda (escopo-v1 §4.2): paciente, itens do catálogo vendável, preço (editável conforme o papel), desconto por item ou no total,
// vendedor/indicador e alerta/aceite de manipulado em unidade sem licença (F18). O servidor revalida tudo.
import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";

import { CentsInput, DecimalInput, Field, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAcceptCompliance, useComplianceStatus, useSaleCatalog, useSalePatients, useSaveSale } from "@/hooks/useFinSales";
import { useUnits } from "@/hooks/useFin";
import { formatBRL } from "@/lib/domain/finance";
import { computeSale, financeSalesErrorMessage, type SaleItemInput } from "@/lib/domain/finSales";

type Kind = "service" | "package" | "product";
interface Line { kind: Kind; refId: string; quantity: number | null; priceCents: number | null; discountPct: number | null }
const KIND_LABEL: Record<Kind, string> = { service: "Serviço", package: "Pacote", product: "Produto / manipulado" };

export interface NewSaleDialogProps {
  clinicId: string;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialPatient?: { id: string; name: string } | null;
  onSaved?: (saleId: string) => void;
}

export function NewSaleDialog({ clinicId, isAdmin, open, onOpenChange, initialPatient, onSaved }: NewSaleDialogProps) {
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const [unitId, setUnitId] = useState<string>("");
  const unit = unitId || units.find((u) => u.is_primary)?.id || units[0]?.id || "";
  const catalog = useSaleCatalog(clinicId, unit || null).data;
  const [search, setSearch] = useState("");
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(initialPatient ?? null);
  const found = useSalePatients(clinicId, search.trim()).data ?? [];
  const [lines, setLines] = useState<Line[]>([{ kind: "service", refId: "", quantity: 1, priceCents: null, discountPct: null }]);
  const [totalDiscount, setTotalDiscount] = useState<number | null>(null);
  const [seller, setSeller] = useState("");
  const [referrer, setReferrer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useSaveSale(clinicId);
  const accept = useAcceptCompliance(clinicId);

  const optionsOf = (k: Kind) => (k === "service" ? catalog?.services : k === "package" ? catalog?.packages : catalog?.products) ?? [];
  const catalogPrice = (l: Line) => (optionsOf(l.kind).find((o) => o.id === l.refId)?.price_cents ?? null);
  const priceOf = (l: Line) => l.priceCents ?? catalogPrice(l) ?? 0;
  const hasCompounded = lines.some((l) => l.kind === "product" && catalog?.products.find((p) => p.id === l.refId)?.item_type === "compounded");
  const compliance = useComplianceStatus(clinicId, hasCompounded ? unit : null).data;

  const preview = useMemo(() => {
    const ready = lines.filter((l) => l.refId && l.quantity && l.quantity > 0);
    if (ready.length !== lines.length) return null;
    try {
      const items: SaleItemInput[] = lines.map((l) => ({ unitPriceCents: priceOf(l), quantity: l.quantity as number, discountPct: l.discountPct }));
      return computeSale(items, { cents: totalDiscount ?? 0 });
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, totalDiscount, catalog]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function submit() {
    if (!patient) return setError("Escolha o paciente.");
    if (!unit) return setError("Escolha a unidade.");
    if (!preview) return setError("Preencha item e quantidade de cada linha (e confira os descontos).");
    if (preview.netCents <= 0) return setError("O total da venda precisa ser maior que zero.");
    if (hasCompounded && compliance?.blocked) return setError("Manipulado em unidade sem licença sanitária: o Owner precisa dar o aceite desta unidade.");
    setError(null);
    save.mutate({
      unitId: unit, patientId: patient.id, sellerId: seller || null, referrerId: referrer || null, totalDiscountCents: totalDiscount ?? 0,
      items: lines.map((l) => ({
        itemType: l.kind, refId: l.refId, quantity: l.quantity as number,
        unitPriceCents: l.priceCents != null && l.priceCents !== catalogPrice(l) ? l.priceCents : undefined, discountPct: l.discountPct,
      })),
    }, { onSuccess: (id) => { onOpenChange(false); onSaved?.(id as string); }, onError: (e) => setError(financeSalesErrorMessage(e)) });
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Nova venda" description="Itens, preço, desconto e vendedor. O recebimento é lançado depois, na própria venda." onSubmit={submit} pending={save.isPending} error={error} submitLabel="Registrar venda" wide>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Unidade" htmlFor="sale-unit">
          <NativeSelect id="sale-unit" value={unit} onChange={(e) => { setUnitId(e.target.value); setLines((c) => c.map((l) => ({ ...l, refId: "", priceCents: null }))); }}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Paciente" htmlFor="sale-patient-search">
          {patient ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium">{patient.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPatient(null)}>Trocar</Button>
            </div>
          ) : (
            <div className="space-y-1">
              <Input id="sale-patient-search" placeholder="Buscar pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} />
              <ul className="max-h-40 overflow-auto rounded-md border" aria-label="Pacientes encontrados">
                {found.length === 0 ? <li className="px-3 py-2 text-xs text-muted-foreground">Nenhum paciente encontrado.</li> : found.map((p) => (
                  <li key={p.patient_id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setPatient({ id: p.patient_id, name: p.full_name })}>{p.full_name}</button></li>
                ))}
              </ul>
            </div>
          )}
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Itens</p>
        {lines.map((l, i) => (
          <div key={i} className="grid min-w-0 grid-cols-2 items-end gap-2 rounded-md border p-2 md:grid-cols-[9rem_minmax(0,1fr)_4.5rem_7rem_5rem_auto]">
            <Field label="Tipo" htmlFor={`sl-k-${i}`}>
              <NativeSelect id={`sl-k-${i}`} value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as Kind, refId: "", priceCents: null })}>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Item" htmlFor={`sl-i-${i}`} className="col-span-2 md:col-span-1">
              <NativeSelect id={`sl-i-${i}`} value={l.refId} onChange={(e) => setLine(i, { refId: e.target.value, priceCents: null })}>
                <option value="">Selecione…</option>
                {optionsOf(l.kind).map((o) => <option key={o.id} value={o.id}>{o.name} — {formatBRL(o.price_cents)}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Qtd." htmlFor={`sl-q-${i}`}><DecimalInput id={`sl-q-${i}`} value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} /></Field>
            <Field label="Preço (R$)" htmlFor={`sl-p-${i}`}>
              <CentsInput key={`${l.kind}-${l.refId}`} id={`sl-p-${i}`} value={l.priceCents ?? catalogPrice(l)} onChange={(v) => setLine(i, { priceCents: v })} disabled={!catalog?.can_edit_price} />
            </Field>
            <Field label="Desc. %" htmlFor={`sl-d-${i}`}><DecimalInput id={`sl-d-${i}`} value={l.discountPct} onChange={(v) => setLine(i, { discountPct: v })} maxDecimals={2} /></Field>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remover item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((c) => c.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
            {preview ? <p className="col-span-full text-xs text-muted-foreground">Valor líquido do item: <strong className="tabular-nums text-foreground">{formatBRL(preview.lines[i].netCents)}</strong></p> : null}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((c) => [...c, { kind: "service", refId: "", quantity: 1, priceCents: null, discountPct: null }])}><Plus aria-hidden /> Adicionar item</Button>
        {catalog && !catalog.can_edit_price ? <p className="text-xs text-muted-foreground">O preço de tabela só pode ser alterado por Gestor, Financeiro ou administrador.</p> : null}
      </div>

      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <Field label="Desconto no total (R$)" htmlFor="sale-disc" hint="Rateado entre os itens, proporcional ao valor de cada um.">
          <CentsInput id="sale-disc" value={totalDiscount} onChange={setTotalDiscount} />
        </Field>
        <Field label="Vendedor" htmlFor="sale-seller">
          <NativeSelect id="sale-seller" value={seller} onChange={(e) => setSeller(e.target.value)}>
            <option value="">Eu (quem registra)</option>
            {(catalog?.professionals ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Indicador (opcional)" htmlFor="sale-ref">
          <NativeSelect id="sale-ref" value={referrer} onChange={(e) => setReferrer(e.target.value)}>
            <option value="">Ninguém</option>
            {(catalog?.professionals ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
      </div>

      {hasCompounded && compliance && !compliance.license_ok ? (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
          <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Esta unidade não tem licença sanitária válida cadastrada. A venda de manipulado exige o aceite do Owner (uma vez por unidade).</p>
          {compliance.accepted ? <p className="text-xs">Aceite do Owner já registrado para esta unidade.</p>
            : isAdmin ? <Button type="button" size="sm" disabled={accept.isPending} onClick={() => accept.mutate({ unitId: unit })}>Dar o aceite como Owner desta unidade</Button>
            : <p className="text-xs">Peça ao Owner da clínica para dar o aceite; depois a venda é liberada.</p>}
        </div>
      ) : null}

      {preview ? (
        <p className="rounded-md bg-muted/40 p-3 text-sm" role="status">
          Bruto <strong className="tabular-nums">{formatBRL(preview.grossCents)}</strong> · desconto <strong className="tabular-nums">{formatBRL(preview.discountCents)}</strong> · total <strong className="tabular-nums">{formatBRL(preview.netCents)}</strong>
        </p>
      ) : null}
    </FormDialog>
  );
}
