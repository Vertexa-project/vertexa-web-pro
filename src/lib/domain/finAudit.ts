// Apresentação do Histórico (fin_audit_log): rótulos, diferença antes → depois e formatação dos valores.
import { formatBRL } from "./finance";

export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  unit: "Unidade",
  staff_roles: "Papéis da equipe",
  service: "Serviço",
  service_kit: "Kit do serviço",
  package: "Pacote",
  professional_finance: "Dados financeiros do profissional",
  acquirer: "Meio de pagamento",
  tax_rate: "Alíquota de imposto",
  settings: "Configurações financeiras",
  stock_item: "Item de estoque",
  stock_movement: "Movimentação de estoque",
  stock_entry: "Entrada de estoque",
  stock_supplier: "Fornecedor",
  stock_item_map: "De/para do fornecedor",
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: "Criou",
  update: "Alterou",
  deactivate: "Desativou",
  reverse: "Estornou",
  view_sensitive: "Leu dado sensível",
};

const FIELD_LABEL: Record<string, string> = {
  brand: "Bandeira", modality: "Modalidade", rule_type: "Tipo de retenção", anticipation: "Antecipação", anticipation_fee_pct: "Taxa de antecipação (%)", anticipation_days: "Dias de antecipação",
  quantity: "Quantidade", reference_price_cents: "Referência", min_base_cents: "Retém a partir de", waive_if_simples: "Dispensa se Simples", valid_from: "Vigência de", valid_to: "Vigência até", label: "Nome",
  min_qty: "Mínimo", role: "Papel",
  name: "Nome", is_active: "Ativo", is_primary: "Principal", license_number: "Licença sanitária", license_valid_until: "Validade da licença",
  category: "Categoria", default_price_cents: "Preço padrão", price_cents: "Valor", validity_days: "Validade (dias)", roles: "Papéis",
  unit_prices: "Preços por unidade", items: "Composição", kit: "Kit", minimums: "Estoque mínimo", item_type: "Tipo", manufacturer: "Fabricante",
  fractional: "Uso fracionado", opened_validity_days: "Validade após aberto (dias)", individual_use: "Uso individual por paciente", lot_control: "Controla lote e validade",
  sellable: "Venda ao paciente", sale_price_cents: "Preço de venda", ean: "Código de barras", anvisa_reg: "Registro Anvisa", controlled: "Controlado (Portaria 344)",
  bond_type: "Vínculo", tax_id: "CPF/CNPJ", simples_optant: "Optante pelo Simples", pix_key: "Chave Pix", bank_name: "Banco", bank_agency: "Agência", bank_account: "Conta",
  requires_invoice: "Exige NF", all_units: "Todas as unidades", unit_ids: "Unidades", withholdings: "Retenções", period: "Competência", rate_pct: "Alíquota (%)",
  auto_settle: "Liquidação automática", deduct_fee: "Deduzir taxa", deduct_tax: "Deduzir imposto", deduct_material: "Deduzir material", cash_diff_limit_cents: "Limite de diferença do caixa",
  accept_days: "Prazo de aceite (dias)", patient_display: "Paciente no extrato", tier_base: "Base das faixas", kind: "Tipo", flat_fee_pct: "Taxa (%)", flat_fee_cents: "Taxa fixa",
  settle_days: "Prazo de liquidação (dias)", fees: "Taxas por bandeira", purchase_unit: "Unidade de compra", stock_unit: "Unidade de estoque", consumption_unit: "Unidade de consumo",
  purchase_to_stock_factor: "Fator compra → estoque", stock_to_consumption_factor: "Fator estoque → consumo",
  // Entrega 3 (estoque)
  movement_type: "Movimento", item_name: "Item", lot_code: "Lote", expiry_date: "Validade", qty: "Quantidade", unit_cost_cents: "Custo unitário", total_cost_cents: "Custo total",
  balance_after: "Saldo depois", avg_cost_after_cents: "Custo médio depois", loss_kind: "Tipo de perda", purpose: "Setor / finalidade", entry_type: "Tipo de entrada",
  invoice_number: "Nota", invoice_key: "Chave da NF-e", freight_cents: "Frete", items_total_cents: "Total dos itens", total_cents: "Total", lines: "Linhas", movements: "Movimentos estornados",
  supplier_code: "Código do fornecedor", conversion_factor: "Fator de conversão", tax_id_supplier: "CNPJ",
};

const IGNORED = new Set(["id", "clinic_id", "created_at", "updated_at", "created_by", "unit_id", "professional_id", "position", "service_id", "stock_item_id", "item_id", "acquirer_id", "package_id",
  "lot_id", "open_unit_id", "entry_id", "sale_id", "patient_id", "supplier_id", "reversed_movement_id", "appointment_id", "reversed_by"]);

export function auditFieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? key;
}

/** Nomes para trocar os ids do registro (item, serviço, unidade) por texto. Sem o nome, o id nunca aparece: vira «item removido». */
export interface AuditCtx {
  itemName?: (id: string) => string | undefined;
  serviceName?: (id: string) => string | undefined;
  unitName?: (id: string) => string | undefined;
}

// Tradução dos valores de lista fechada (o banco guarda o código; a tela mostra português).
const ENUM_TEXT: Record<string, Record<string, string>> = {
  item_type: { medication: "Medicação aplicada", compounded: "Manipulado", resale: "Produto de revenda", consumable: "Material de consumo", service: "Sessão", product: "Produto" },
  category: { consulta: "Consulta", procedimento: "Procedimento", aplicacao: "Aplicação", avaliacao: "Avaliação", sessao: "Sessão", outro: "Outro" },
  bond_type: { pj: "PJ", autonomo: "Autônomo", clt: "CLT", socio: "Sócio" },
  kind: { machine: "Maquininha", pix: "Pix", cash: "Dinheiro", transfer: "Transferência", boleto: "Boleto" },
  modality: { debit: "Débito", credit_1: "Crédito à vista", credit_2_6: "Parcelado 2–6", credit_7_12: "Parcelado 7–12" },
  rule_type: { irrf: "IRRF", pis_cofins_csll: "PIS/COFINS/CSLL", iss: "ISS", outra: "Outra" },
  role: { responsavel: "Responsável", executor: "Executor", auxiliar: "Auxiliar", gestor: "Gestor", financeiro: "Financeiro", recepcao: "Recepção", estoquista: "Estoquista" },
  patient_display: { initials: "Iniciais", full: "Nome completo", hidden: "Oculto" },
  movement_type: { initial_balance: "Saldo inicial", purchase: "Compra", xml_purchase: "Compra por XML da NF-e", bonus: "Bonificação / doação", sector: "Consumo interno", loss: "Perda / quebra / vencimento", appointment: "Uso por paciente", sale: "Venda ao paciente", reversal: "Estorno" },
  entry_type: { initial_balance: "Saldo inicial", purchase: "Compra", xml_purchase: "Compra por XML da NF-e", bonus: "Bonificação / doação" },
  loss_kind: { loss: "Perda", breakage: "Quebra / avaria", expiry: "Vencimento" },
  tier_base: { organization: "Organização (todas as unidades)", unit: "Por unidade" },
};
const DATE_KEYS = new Set(["license_valid_until", "valid_from", "valid_to", "expiry_date"]);

const fmtDate = (v: string): string => (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : v);
const num = (n: number): string => String(n).replace(".", ",");
const pct = (n: unknown): string => `${num(Number(n))}%`;
const REMOVED = "item removido";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function unitsText(ids: unknown, ctx?: AuditCtx): string {
  const list = Array.isArray(ids) ? ids : [];
  return list.map((id) => ctx?.unitName?.(String(id)) ?? "unidade removida").join(", ");
}

/** Cada linha de uma lista estruturada, em português (sem JSON). */
function lineText(key: string, row: Obj, ctx?: AuditCtx): string {
  if (key === "kit") return `${ctx?.itemName?.(String(row.item_id)) ?? REMOVED} × ${num(Number(row.quantity))}`;
  if (key === "minimums") return `${ctx?.unitName?.(String(row.unit_id)) ?? "Unidade"}: ${num(Number(row.min_qty))}`;
  if (key === "unit_prices") return `${ctx?.unitName?.(String(row.unit_id)) ?? "Unidade"}: ${formatBRL(Number(row.price_cents))}`;
  if (key === "items") {
    const isService = row.item_type === "service";
    const name = (isService ? ctx?.serviceName?.(String(row.service_id)) : ctx?.itemName?.(String(row.stock_item_id))) ?? REMOVED;
    const parts = [`${isService ? "Sessão" : "Produto"}: ${name} × ${num(Number(row.quantity))}`];
    if (row.reference_price_cents != null) parts.push(`referência ${formatBRL(Number(row.reference_price_cents))}`);
    if (row.allocated_unit_cents != null) parts.push(`rateado ${formatBRL(Number(row.allocated_unit_cents))} por unidade`);
    return parts.join(" · ");
  }
  if (key === "fees") {
    const parts = [`${row.brand}`, ENUM_TEXT.modality[String(row.modality)] ?? String(row.modality), pct(row.fee_pct), `D+${row.settle_days}`];
    if (row.anticipation) parts.push(`antecipa a ${pct(row.anticipation_fee_pct)}`);
    return parts.join(" · ");
  }
  if (key === "withholdings") {
    const type = row.rule_type === "outra" && row.label ? String(row.label) : ENUM_TEXT.rule_type[String(row.rule_type)] ?? String(row.rule_type);
    const parts = [`Retenção ${type} ${pct(row.rate_pct)}${row.waive_if_simples ? " (dispensa se Simples)" : ""}`];
    if (Number(row.min_base_cents) > 0) parts.push(`a partir de ${formatBRL(Number(row.min_base_cents))}`);
    if (row.valid_from) parts.push(`vigência ${fmtDate(String(row.valid_from))}${row.valid_to ? ` a ${fmtDate(String(row.valid_to))}` : " em diante"}`);
    if (row.is_active === false) parts.push("desativada");
    return parts.join(" · ");
  }
  if (key === "roles") {
    const role = ENUM_TEXT.role[String(row.role)] ?? String(row.role);
    return row.all_units === false ? `${role} (${unitsText(row.unit_ids, ctx) || "unidades escolhidas"})` : `${role} (todas as unidades)`;
  }
  // Qualquer outra estrutura: «Rótulo: valor» por campo, nunca JSON cru.
  return Object.entries(row).filter(([k]) => !IGNORED.has(k)).map(([k, v]) => `${auditFieldLabel(k)}: ${auditValueText(k, v, ctx)}`).join(" · ");
}

/** Valor legível; listas viram uma linha por item (separadas por quebra de linha). */
export function auditValueText(key: string, value: unknown, ctx?: AuditCtx): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number" && key.endsWith("_cents")) return formatBRL(value);
  if (typeof value === "number") return num(value);
  if (typeof value === "string") {
    if (DATE_KEYS.has(key)) return fmtDate(value);
    return ENUM_TEXT[key === "roles" ? "role" : key]?.[value] ?? value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (key === "unit_ids") return unitsText(value, ctx) || "—";
    return value.map((v) => (isObj(v) ? lineText(key, v, ctx) : auditValueText(key, v, ctx))).join("\n");
  }
  if (isObj(value)) return lineText(key, value, ctx);
  return String(value);
}

export interface AuditChange { field: string; label: string; before: string; after: string }

/** Campos que mudaram (ou, na criação, todos os preenchidos). */
export function diffAudit(before: Record<string, unknown> | null, after: Record<string, unknown> | null, ctx?: AuditCtx): AuditChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: AuditChange[] = [];
  for (const key of [...keys].sort()) {
    if (IGNORED.has(key)) continue;
    const b = before?.[key];
    const a = after?.[key];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    const bt = auditValueText(key, b, ctx);
    const at = auditValueText(key, a, ctx);
    if (bt === at) continue; // ex.: ausente → vazio não é mudança
    out.push({ field: key, label: auditFieldLabel(key), before: bt, after: at });
  }
  return out;
}
