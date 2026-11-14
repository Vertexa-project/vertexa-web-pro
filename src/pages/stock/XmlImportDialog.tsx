// Entrada por XML da NF-e (escopo-v1 §8.2, E14): o arquivo é lido NO NAVEGADOR; a pessoa confere, vincula os itens novos do fornecedor ao cadastro
// (o de/para fica salvo para as próximas notas), completa lote e validade e confirma. Só a confirmação grava, tudo ou nada, no servidor.
import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp } from "lucide-react";

import { Field, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { DecimalInput } from "@/components/fin/FinUi";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useStockItems, useUnits } from "@/hooks/useFin";
import { useCreateEntry, useEntryByKey, useSupplierMaps, useSuppliers } from "@/hooks/useStockMoves";
import { formatBRL } from "@/lib/domain/finance";
import {
  buildEntryLines, matchNfeItems, NFE_ERROR_TEXT, NfeError, parseNfeXml, splitByLots, validateNfeLines, type CatalogItem, type NfeDoc, type NfeLineDraft, type MatchSource,
} from "@/lib/domain/nfe";
import { allocateFreight, formatQty, stockMoveErrorMessage, todayIsoBR } from "@/lib/domain/stockMoves";

const SOURCE_TEXT: Record<MatchSource, string> = { map: "vínculo salvo", ean: "código de barras", name: "mesmo nome", none: "sem vínculo" };
const br = (iso: string | null) =>
  !iso ? "—" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");
const maskTax = (d: string) => (d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : d);

export function XmlImportDialog({ clinicId, onClose }: { clinicId: string; onClose: () => void }) {
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const itemsQ = useStockItems(clinicId);
  const allItems = itemsQ.data;
  const items = useMemo(() => (allItems ?? []).filter((i) => i.is_active), [allItems]);
  const suppliersQ = useSuppliers(clinicId);
  const suppliers = suppliersQ.data ?? [];
  const [unitId, setUnitId] = useState("");
  const unit = unitId || units.find((u) => u.is_primary)?.id || units[0]?.id || "";
  const [doc, setDoc] = useState<NfeDoc | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<NfeLineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const save = useCreateEntry(clinicId);
  const today = todayIsoBR();

  const supplier = doc ? suppliers.find((s) => s.tax_id === doc.supplier.taxId) ?? null : null;
  const maps = useSupplierMaps(supplier?.id ?? null);
  const dup = useEntryByKey(clinicId, doc?.key ?? null).data;
  const catalog: CatalogItem[] = useMemo(() => items.map((i) => ({ id: i.id, name: i.name, ean: i.ean, purchaseUnit: i.purchase_unit, purchaseToStockFactor: i.purchase_to_stock_factor, isActive: i.is_active })), [items]);
  // Só casa os itens depois de cadastro, fornecedores e de/para carregados: rascunho é feito uma vez por nota.
  const mapsReady = itemsQ.isSuccess && suppliersQ.isSuccess && !suppliersQ.isFetching && (!supplier || (maps.isSuccess && !maps.isFetching));
  const matches = useMemo(() => (doc && mapsReady ? matchNfeItems(doc.items, catalog, maps.data ?? []) : []), [doc, catalog, maps.data, mapsReady]);

  // Rascunho inicial das linhas (UMA vez por nota): vínculo sugerido, fator e o primeiro lote da nota (rastro).
  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!doc || matches.length === 0 || initializedFor.current === doc.key) return;
    initializedFor.current = doc.key;
    setDrafts(matches.map((m) => ({ itemId: m.itemId, factor: m.factor, lotCode: m.nfeItem.lots[0]?.code ?? "", expiry: m.nfeItem.lots[0]?.expiry ?? "" })));
  }, [doc, matches]);

  async function onFile(file: File | undefined) {
    setFileError(null); setDoc(null); setDrafts([]); setError(null); setLineErrors({}); initializedFor.current = null;
    if (!file) return;
    try {
      setDoc(parseNfeXml(await file.text()));
    } catch (e) {
      setFileError(e instanceof NfeError ? NFE_ERROR_TEXT[e.code] : "Não consegui ler este arquivo.");
    }
  }

  const setDraft = (i: number, patch: Partial<NfeLineDraft>) => setDrafts((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const meta = useMemo(() => new Map(items.map((i) => [i.id, { lotControl: i.lot_control, fractional: i.fractional, name: i.name }])), [items]);
  const lineTotals = useMemo(() => {
    if (!doc) return { items: 0, all: 0 };
    const lines = buildEntryLines(doc.items, drafts);
    const base = lines.map((l) => l.lineTotalCents);
    const sum = base.reduce((a, v) => a + v, 0);
    try { return { items: sum, all: allocateFreight(base, doc.freightCents).reduce((a, v) => a + v, 0) }; } catch { return { items: sum, all: sum }; }
  }, [doc, drafts]);

  function submit() {
    if (!doc) return setError("Escolha o arquivo XML da nota.");
    if (dup) return setError(`Essa nota já foi lançada em ${br(dup.received_on)}. Para lançar de novo, estorne a anterior em Entradas.`);
    const errs = validateNfeLines(doc.items, drafts, meta, today);
    const lines = buildEntryLines(doc.items, drafts);
    setLineErrors(errs);
    if (Object.keys(errs).length > 0) return setError("Corrija as linhas destacadas.");
    if (lines.length === 0) return setError("Nenhum item da nota entra no estoque. Vincule ao menos um item.");
    setError(null);
    save.mutate({
      unitId: unit,
      header: {
        entryType: "xml_purchase", supplierId: supplier?.id ?? null, supplierNew: supplier ? null : { name: doc.supplier.name, taxId: doc.supplier.taxId },
        invoiceNumber: doc.number, invoiceKey: doc.key, issueDate: doc.issueDate ?? undefined, freightCents: doc.freightCents,
      },
      lines,
    }, { onSuccess: onClose, onError: (e) => setError(stockMoveErrorMessage(e)) });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Importar XML da NF-e" description="Escolha o XML da nota, confira os itens, vincule os que ainda não conhece e confirme. Nada é gravado antes da confirmação." onSubmit={submit} pending={save.isPending} error={error} submitLabel="Confirmar entrada" wide>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Unidade que recebe" htmlFor="xml-unit">
          <NativeSelect id="xml-unit" value={unit} onChange={(e) => setUnitId(e.target.value)}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Arquivo XML da NF-e" htmlFor="xml-file" error={fileError} hint="O arquivo é lido aqui no navegador; nada é enviado antes de você confirmar.">
          <Input id="xml-file" type="file" accept=".xml,text/xml,application/xml" onChange={(e) => void onFile(e.target.files?.[0])} />
        </Field>
      </div>

      {!doc && !fileError ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><FileUp className="h-4 w-4" aria-hidden /> Escolha o arquivo para ver os itens da nota.</p> : null}

      {doc ? (
        <div className="min-w-0 space-y-4">
          <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Fornecedor</dt><dd className="break-words font-medium">{doc.supplier.name}</dd><dd className="text-xs text-muted-foreground">{maskTax(doc.supplier.taxId)}{supplier ? "" : " · novo"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Nota</dt><dd className="font-medium">{doc.number}{doc.series ? ` · série ${doc.series}` : ""}</dd><dd className="text-xs text-muted-foreground">emitida em {br(doc.issueDate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Frete</dt><dd className="tabular-nums">{formatBRL(doc.freightCents)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Total que entra</dt><dd className="font-medium tabular-nums">{formatBRL(lineTotals.all)}</dd></div>
            <div className="col-span-2 min-w-0 sm:col-span-4"><dt className="text-xs text-muted-foreground">Chave de acesso</dt><dd className="break-all text-xs tabular-nums">{doc.key}</dd></div>
          </dl>
          {dup ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">Essa nota já foi lançada em {br(dup.received_on)}. Estorne a entrada anterior para lançar de novo.</p> : null}

          <div className="space-y-2" aria-label="Itens da nota">
            {doc.items.map((it, i) => {
              const m = matches[i];
              const d = drafts[i];
              if (!m || !d) return null;
              const chosen = items.find((x) => x.id === d.itemId);
              const split = splitByLots(it);
              const stockQty = Math.round(it.qty * d.factor * 1000) / 1000;
              return (
                <div key={it.n} className="min-w-0 space-y-2 rounded-md border p-3">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="break-words text-sm font-medium">{it.n}. {it.name}</p><p className="text-xs text-muted-foreground">Código {it.code || "—"} · {formatQty(it.qty)} {it.unit} · {formatBRL(it.totalCents)}</p></div>
                    <Badge tone={d.skip ? "muted" : m.source === "none" && !d.itemId ? "warning" : "success"}>{d.skip ? "Não entra" : d.itemId ? (m.itemId === d.itemId ? SOURCE_TEXT[m.source] : "vínculo escolhido") : SOURCE_TEXT.none}</Badge>
                  </div>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_7rem_minmax(0,1fr)_9rem]">
                    <Field label="Item do cadastro" htmlFor={`xml-i-${i}`} error={lineErrors[i]}>
                      <NativeSelect id={`xml-i-${i}`} value={d.skip ? "__skip" : d.itemId ?? ""} onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__skip") return setDraft(i, { skip: true, itemId: null });
                        const picked = catalog.find((c) => c.id === v);
                        const unitOk = picked && picked.purchaseUnit.trim().toLowerCase() === it.unit.trim().toLowerCase();
                        setDraft(i, { skip: false, itemId: v || null, factor: unitOk ? picked.purchaseToStockFactor : 1 });
                      }}>
                        <option value="">Escolha o item…</option>
                        {items.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.stock_unit})</option>)}
                        <option value="__skip">Não entra no estoque</option>
                      </NativeSelect>
                    </Field>
                    <Field label={`1 ${it.unit || "un. da nota"} = ? ${chosen?.stock_unit ?? "estoque"}`} htmlFor={`xml-f-${i}`}>
                      <DecimalInput id={`xml-f-${i}`} value={d.factor} onChange={(v) => setDraft(i, { factor: v ?? 0 })} maxDecimals={4} disabled={d.skip} />
                    </Field>
                    {split ? (
                      <div className="min-w-0 text-xs sm:col-span-2 lg:col-span-2">
                        <p className="font-medium">Lotes da nota</p>
                        <ul>{split.map((l) => <li key={l.code}>{l.code} · vence {br(l.expiry)} · {formatQty((l.qty as number) * d.factor)} {chosen?.stock_unit ?? ""}</li>)}</ul>
                      </div>
                    ) : (
                      <>
                        <Field label={chosen?.lot_control ? "Lote (obrigatório)" : "Lote"} htmlFor={`xml-l-${i}`}><Input id={`xml-l-${i}`} value={d.lotCode} disabled={d.skip} onChange={(e) => setDraft(i, { lotCode: e.target.value })} maxLength={60} /></Field>
                        <Field label={chosen?.lot_control ? "Validade (obrigatória)" : "Validade"} htmlFor={`xml-e-${i}`}><Input id={`xml-e-${i}`} type="date" value={d.expiry} disabled={d.skip} min={today} onChange={(e) => setDraft(i, { expiry: e.target.value })} /></Field>
                      </>
                    )}
                  </div>
                  {!d.skip && d.itemId ? <p className="text-xs text-muted-foreground">Entram {formatQty(stockQty)} {chosen?.stock_unit} a {formatBRL(Math.round(it.totalCents / (stockQty || 1)))} cada (antes do frete).</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </FormDialog>
  );
}
