// Textos das regras de repasse (lista e exportação): vale para / valor.
import { SERVICE_CATEGORY_LABEL } from "@/lib/api/finCatalog";
import type { PayoutRuleRow } from "@/lib/api/finPayout";
import { formatBRL } from "@/lib/domain/finance";

const pctTxt = (v: number) => `${String(v).replace(".", ",")}%`;
export const targetText = (r: PayoutRuleRow) => (r.target_type === "service" ? `Serviço: ${r.service_name ?? "—"}` : r.target_type === "category" && r.category ? `Categoria: ${SERVICE_CATEGORY_LABEL[r.category]}` : r.target_type === "item" ? `Item: ${r.item_name ?? "—"}` : r.rule_type === "product_commission" ? "Todos os produtos" : "Padrão");
export const valueText = (r: PayoutRuleRow): string => {
  if (r.rule_type === "none") return "Sem repasse";
  if (r.tiers) return r.tiers.map((t) => `${pctTxt(t.pct)}${t.up_to_cents === null ? " acima" : ` até ${formatBRL(t.up_to_cents)}`}`).join(" · ");
  if (r.rule_type === "usage_fee") return r.usage_fee_mode === "pct" ? `${pctTxt(r.pct ?? 0)} do liquidado` : `${formatBRL(r.amount_cents ?? 0)}/mês`;
  if (r.rule_type === "product_commission") return r.pct !== null ? pctTxt(r.pct) : `${formatBRL(r.amount_cents ?? 0)}/un.`;
  if (r.pct !== null) return pctTxt(r.pct);
  return `${formatBRL(r.amount_cents ?? 0)}${r.rule_type === "fixed_monthly" || r.rule_type === "min_guarantee" ? "/mês" : ""}`;
};

