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
  recepcao: "Venda e recebimento (chega nas próximas entregas). Sem acesso a cadastros financeiros.",
  estoquista: "Itens, entradas, saídas e contagem do estoque. Sem acesso ao financeiro.",
};

export interface FinAccess {
  isAdmin: boolean;
  roles: { role: FinRole; allUnits: boolean; unitIds: string[] }[];
  can: Record<string, boolean>;
}

export const NO_FIN_ACCESS: FinAccess = { isAdmin: false, roles: [], can: {} };

export type FinArea =
  | "units" | "staff" | "services" | "packages" | "payment" | "tax" | "pro_finance" | "settings" | "audit" | "stock_items";

export function finCan(access: FinAccess, area: FinArea, mode: "read" | "write" = "read"): boolean {
  return access.can[`${area}_${mode}`] === true;
}

/** Aba "Cadastros" do Financeiro: qualquer cadastro financeiro legível. */
export function canSeeFinanceCadastros(a: FinAccess): boolean {
  return (["services", "packages", "payment", "tax", "pro_finance", "settings", "audit"] as FinArea[]).some((area) => finCan(a, area));
}

/** Item "Financeiro" do menu: admin (Mensalidades) ou quem lê algum cadastro. */
export function canSeeFinanceMenu(a: FinAccess): boolean {
  return a.isAdmin || canSeeFinanceCadastros(a);
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
