// Acesso ao módulo Financeiro/Estoque. A AUTORIDADE é do servidor (RPC public.fin_my_access + fin_can nas RPCs/RLS);
// aqui só se decide o que MOSTRAR (menu, abas, botões). Matriz da escopo-v1 §3.

export type FinRole = "gestor" | "financeiro" | "recepcao" | "estoquista";
export const FIN_ROLES: FinRole[] = ["gestor", "financeiro", "recepcao", "estoquista"];

export const FIN_ROLE_LABEL: Record<FinRole, string> = {
  gestor: "Gestor",
  financeiro: "Financeiro",
  recepcao: "Recepção",
  estoquista: "Estoquista",
};

export const FIN_ROLE_HINT: Record<FinRole, string> = {
  gestor: "Cadastros financeiros, histórico e estoque nas unidades autorizadas.",
  financeiro: "Cadastros financeiros e consulta de estoque. Dados bancários e fiscais dos profissionais.",
  recepcao: "Registra venda e recebimento e opera o próprio caixa. Sem acesso a cadastros financeiros, taxas e títulos.",
  estoquista: "Itens, entradas, saídas e contagem do estoque. Sem acesso ao financeiro.",
};

export interface FinAccess {
  isAdmin: boolean;
  roles: { role: FinRole; allUnits: boolean; unitIds: string[] }[];
  can: Record<string, boolean>;
}

export const NO_FIN_ACCESS: FinAccess = { isAdmin: false, roles: [], can: {} };

export type FinArea =
  | "units" | "staff" | "services" | "packages" | "payment" | "tax" | "pro_finance" | "settings" | "audit" | "stock_items"
  // Entrega 2
  | "sales" | "sales_price" | "sale_cancel" | "cash" | "cash_all" | "cash_approve" | "receivables" | "receivables_fix" | "compliance";

export function finCan(access: FinAccess, area: FinArea, mode: "read" | "write" = "read"): boolean {
  return access.can[`${area}_${mode}`] === true;
}

/** Aba "Cadastros" do Financeiro: qualquer cadastro financeiro legível. */
export function canSeeFinanceCadastros(a: FinAccess): boolean {
  return (["services", "packages", "payment", "tax", "pro_finance", "settings", "audit"] as FinArea[]).some((area) => finCan(a, area));
}

/** Aba «Vendas»: quem lança/consulta venda (Recepção, Financeiro, Gestor, Admin) ou o profissional com a PRÓPRIA produção. */
export function canSeeSales(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "sales") || a.can.own_sales_read === true;
}
/** Aba «Caixa»: quem opera caixa (Recepção, Financeiro, Gestor, Admin). */
export function canSeeCash(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "cash") || finCan(a, "cash_all");
}
/** Aba «Títulos»: Financeiro, Gestor e Admin (a Recepção não vê taxa). */
export function canSeeReceivables(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "receivables");
}

export interface FinanceTab { to: string; label: string; end?: boolean }
/** Abas do Financeiro pela matriz de papéis (Entrega 2 inclui Vendas, Títulos e Caixa). */
export function financeTabs(a: FinAccess): FinanceTab[] {
  return [
    ...(a.isAdmin ? [{ to: "/financeiro", label: "Mensalidades", end: true }] : []),
    ...(canSeeSales(a) ? [{ to: "/financeiro/vendas", label: "Vendas" }] : []),
    ...(canSeeReceivables(a) ? [{ to: "/financeiro/titulos", label: "Títulos" }] : []),
    ...(canSeeCash(a) ? [{ to: "/financeiro/caixa", label: "Caixa" }] : []),
    ...(canSeeFinanceCadastros(a) || a.isAdmin ? [{ to: "/financeiro/cadastros", label: "Cadastros" }] : []),
  ];
}

/** Item "Financeiro" do menu: admin (Mensalidades) ou quem lê cadastro, vende ou opera caixa. */
export function canSeeFinanceMenu(a: FinAccess): boolean {
  return a.isAdmin || canSeeFinanceCadastros(a) || canSeeSales(a) || canSeeCash(a);
}

/** Item "Estoque" do menu: admin, gestor, estoquista e financeiro (consulta). */
export function canSeeStockMenu(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "stock_items");
}

export function rowToAccess(raw: unknown): FinAccess {
  const r = (raw ?? {}) as { is_admin?: boolean; roles?: { role: FinRole; all_units: boolean; unit_ids: string[] }[]; can?: Record<string, boolean> };
  return {
    isAdmin: r.is_admin === true,
    roles: (r.roles ?? []).map((x) => ({ role: x.role, allUnits: x.all_units, unitIds: x.unit_ids ?? [] })),
    can: r.can ?? {},
  };
}
