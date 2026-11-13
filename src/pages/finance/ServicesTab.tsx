import { useState } from "react";
import { Plus, Stethoscope, Trash2 } from "lucide-react";

import { ActiveBadge, CentsInput, CheckField, DecimalInput, ExportButtons, Field, FinTable, FormDialog, NativeSelect, ReasonField } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinContext, useSaveService, useServices, useStockItems, useUnits } from "@/hooks/useFin";
import { SERVICE_CATEGORY_LABEL, SERVICE_ROLE_LABEL, type FinService, type ServiceCategory, type ServiceRole } from "@/lib/api/finCatalog";
import { finCan } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";

const serverMessage = (e: unknown): string => {
  const m = (e as { message?: string }).message ?? "";
  if (m.includes("duplicate")) return "Já existe um serviço com esse nome.";
  if (m.includes("REASON_REQUIRED")) return "Informe o motivo da desativação.";
  if (m.includes("INVALID_KIT_ITEM")) return "Um item do kit está inativo ou não existe mais.";
  if ((e as { code?: string }).code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível salvar agora. Tente novamente.";
};

interface KitRow { itemId: string; quantity: number | null }

function ServiceDialog({ clinicId, service, canWrite, onClose }: { clinicId: string; service: FinService | "new" | null; canWrite: boolean; onClose: () => void }) {
  const editing = service && service !== "new" ? service : null;
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const stock = useStockItems(clinicId);
  const items = (stock.data ?? []).filter((i) => i.is_active);
  const save = useSaveService(clinicId);
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState<ServiceCategory>(editing?.category ?? "consulta");
  const [price, setPrice] = useState<number | null>(editing?.default_price_cents ?? null);
  const [roles, setRoles] = useState<ServiceRole[]>(editing?.roles ?? ["responsavel"]);
  const [active, setActive] = useState(editing?.is_active ?? true);
  const [unitPrices, setUnitPrices] = useState<Record<string, number | null>>(() => Object.fromEntries((editing?.unit_prices ?? []).map((u) => [u.unit_id, u.price_cents])));
  const [kit, setKit] = useState<KitRow[]>((editing?.kit ?? []).map((k) => ({ itemId: k.item_id, quantity: k.quantity })));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const deactivating = Boolean(editing && editing.is_active && !active);
  const toggleRole = (r: ServiceRole) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const itemLabel = (id: string) => items.find((i) => i.id === id);

  function submit() {
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Informe o nome do serviço.";
    if (price === null) found.price = "Informe o preço padrão.";
    const badKit = kit.findIndex((k) => !k.itemId || !k.quantity || k.quantity <= 0);
    if (badKit >= 0) found[`kit${badKit}`] = "Escolha o item e uma quantidade maior que zero.";
    else if (new Set(kit.map((k) => k.itemId)).size !== kit.length) found.kit0 = "O mesmo item aparece duas vezes no kit.";
    if (deactivating && reason.trim().length < 3) found.reason = "Informe o motivo da desativação.";
    setFe(found);
    if (Object.keys(found).length > 0 || price === null) return setError(null);
    setError(null);
    save.mutate({
      id: editing?.id ?? null, name: name.trim(), category, defaultPriceCents: price, roles: ["responsavel", ...roles.filter((r) => r !== "responsavel")], isActive: active,
      unitPrices: Object.entries(unitPrices).filter(([, v]) => v !== null).map(([unitId, v]) => ({ unitId, priceCents: v as number })),
      kit: kit.map((k) => ({ itemId: k.itemId, quantity: k.quantity as number })), reason: reason.trim() || undefined,
    }, { onSuccess: onClose, onError: (e) => { const m = serverMessage(e); if (m.startsWith("Já existe")) { setFe({ name: m }); setError(null); } else setError(m); } });
  }

  return (
    <FormDialog open={service !== null} onOpenChange={(o) => (!o ? onClose() : undefined)} title={editing ? (canWrite ? "Editar serviço" : "Ver serviço") : "Novo serviço"} onSubmit={submit} pending={save.isPending} error={error} readOnly={!canWrite} wide>
      <fieldset disabled={!canWrite} className="min-w-0 space-y-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Field label="Nome" htmlFor="svc-name" error={fe.name} className="sm:col-span-2"><Input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus /></Field>
          <Field label="Categoria" htmlFor="svc-cat">
            <NativeSelect id="svc-cat" value={category} onChange={(e) => setCategory(e.target.value as ServiceCategory)}>
              {Object.entries(SERVICE_CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Preço padrão (R$)" htmlFor="svc-price" error={fe.price}><CentsInput id="svc-price" value={price} onChange={setPrice} /></Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Papéis previstos no atendimento</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <CheckField id="svc-r-resp" label={`${SERVICE_ROLE_LABEL.responsavel} (obrigatório)`} checked disabled onChange={() => undefined} />
            <CheckField id="svc-r-exec" label={SERVICE_ROLE_LABEL.executor} checked={roles.includes("executor")} onChange={() => toggleRole("executor")} />
            <CheckField id="svc-r-aux" label={SERVICE_ROLE_LABEL.auxiliar} checked={roles.includes("auxiliar")} onChange={() => toggleRole("auxiliar")} />
          </div>
        </div>
        {units.length > 1 ? (
          <div>
            <p className="mb-2 text-sm font-medium">Preço por unidade (opcional — vazio usa o preço padrão)</p>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {units.map((u) => (
                <Field key={u.id} label={u.name} htmlFor={`svc-up-${u.id}`}>
                  <CentsInput id={`svc-up-${u.id}`} value={unitPrices[u.id] ?? null} onChange={(v) => setUnitPrices((cur) => ({ ...cur, [u.id]: v }))} placeholder="Preço padrão" />
                </Field>
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <p className="text-sm font-medium">Kit de estoque do serviço</p>
          <p className="text-xs text-muted-foreground">Itens e quantidades (na unidade de consumo) que saem do estoque quando o atendimento é realizado. A baixa automática chega na Entrega 4.</p>
          {stock.isLoading ? <p className="text-sm text-muted-foreground">Carregando itens…</p> : null}
          {kit.map((k, i) => (
            <div key={i} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2">
              <Field label="Item" htmlFor={`kit-item-${i}`} error={fe[`kit${i}`]}>
                <NativeSelect id={`kit-item-${i}`} value={k.itemId} onChange={(e) => setKit((cur) => cur.map((r, j) => (j === i ? { ...r, itemId: e.target.value } : r)))}>
                  <option value="">Selecione…</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label={`Qtd. (${itemLabel(k.itemId)?.consumption_unit ?? "un"})`} htmlFor={`kit-qty-${i}`}>
                <DecimalInput id={`kit-qty-${i}`} value={k.quantity} onChange={(v) => setKit((cur) => cur.map((r, j) => (j === i ? { ...r, quantity: v } : r)))} />
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover item ${i + 1} do kit`} onClick={() => setKit((cur) => cur.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setKit((cur) => [...cur, { itemId: "", quantity: null }])} disabled={items.length === 0}><Plus aria-hidden /> Adicionar item ao kit</Button>
          {!stock.isLoading && items.length === 0 ? <p className="text-xs text-muted-foreground">Cadastre itens em Estoque para montar o kit.</p> : null}
        </div>
        {editing ? <CheckField id="svc-active" label="Serviço ativo" checked={active} onChange={setActive} /> : null}
        {editing && canWrite ? <ReasonField value={reason} onChange={setReason} required={deactivating} error={fe.reason} /> : null}
      </fieldset>
    </FormDialog>
  );
}

/** Cadastros › Serviços. */
export function ServicesTab() {
  const { clinicId, access } = useFinContext();
  const canRead = finCan(access, "services");
  const canWrite = finCan(access, "services", "write");
  const q = useServices(clinicId, canRead);
  const [editing, setEditing] = useState<FinService | "new" | null>(null);
  const [showInactive, setShowInactive] = useState(true);
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const all = q.data ?? [];
  const rows = showInactive ? all : all.filter((s) => s.is_active);
  const columns: ExportColumn<FinService>[] = [
    { header: "Serviço", value: (s) => s.name },
    { header: "Categoria", value: (s) => SERVICE_CATEGORY_LABEL[s.category] },
    { header: "Preço padrão (R$)", value: (s) => s.default_price_cents, kind: "money" },
    { header: "Papéis", value: (s) => s.roles.map((r) => SERVICE_ROLE_LABEL[r]).join(", ") },
    { header: "Itens no kit", value: (s) => s.kit.length, kind: "qty" },
    { header: "Ativo", value: (s) => s.is_active },
  ];
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExportButtons columns={columns} rows={rows} filename="servicos" sheetName="Serviços" />
        <div className="flex flex-wrap items-center gap-4">
          <CheckField id="svc-show-inactive" label="Mostrar inativos" checked={showInactive} onChange={setShowInactive} />
          {canWrite ? <Button onClick={() => setEditing("new")}><Plus aria-hidden /> Novo serviço</Button> : null}
        </div>
      </div>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Nenhum serviço cadastrado" description="Cadastre consultas, procedimentos e sessões com preço e papéis previstos." action={canWrite ? <Button onClick={() => setEditing("new")}>Novo serviço</Button> : undefined} />
      ) : (
        <FinTable
          label="Serviços" rows={rows} rowKey={(s) => s.id}
          columns={[
            { header: "Serviço", role: "title", cell: (s) => s.name },
            { header: "Situação", role: "badge", cell: (s) => <ActiveBadge active={s.is_active} /> },
            { header: "Categoria", cell: (s) => SERVICE_CATEGORY_LABEL[s.category] },
            { header: "Preço padrão", nowrap: true, cell: (s) => <>{formatBRL(s.default_price_cents)}{s.unit_prices.length > 0 ? <span className="ml-1 text-xs text-muted-foreground">+{s.unit_prices.length} por unidade</span> : null}</> },
            { header: "Papéis", cell: (s) => s.roles.map((r) => SERVICE_ROLE_LABEL[r]).join(", ") },
            { header: "Kit", cell: (s) => (s.kit.length === 0 ? "—" : `${s.kit.length} ${s.kit.length === 1 ? "item" : "itens"}`) },
            { header: "Ações", role: "action", cell: (s) => <Button size="sm" variant="outline" onClick={() => setEditing(s)} aria-label={`${canWrite ? "Editar" : "Ver"} ${s.name}`}>{canWrite ? "Editar" : "Ver"}</Button> },
          ]}
        />
      )}
      {editing ? <ServiceDialog key={editing === "new" ? "new" : editing.id} clinicId={clinicId} service={editing} canWrite={canWrite} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
