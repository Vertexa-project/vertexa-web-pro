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
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: "Criou",
  update: "Alterou",
  deactivate: "Desativou",
  reverse: "Estornou",
  view_sensitive: "Leu dado sensível",
};

const FIELD_LABEL: Record<string, string> = {
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
};

const IGNORED = new Set(["id", "clinic_id", "created_at", "updated_at", "created_by", "unit_id"]);

export function auditFieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? key;
}

export function auditValueText(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number" && key.endsWith("_cents")) return formatBRL(value);
  if (typeof value === "number") return String(value).replace(".", ",");
  if (typeof value === "string") return value;
  const text = JSON.stringify(value);
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

export interface AuditChange { field: string; label: string; before: string; after: string }

/** Campos que mudaram (ou, na criação, todos os preenchidos). */
export function diffAudit(before: Record<string, unknown> | null, after: Record<string, unknown> | null): AuditChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: AuditChange[] = [];
  for (const key of [...keys].sort()) {
    if (IGNORED.has(key)) continue;
    const b = before?.[key];
    const a = after?.[key];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    const bt = auditValueText(key, b);
    const at = auditValueText(key, a);
    if (bt === at) continue; // ex.: ausente → vazio não é mudança
    out.push({ field: key, label: auditFieldLabel(key), before: bt, after: at });
  }
  return out;
}
