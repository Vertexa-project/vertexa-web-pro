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
  | "sales" | "sales_price" | "sale_cancel" | "cash" | "cash_all" | "cash_approve" | "receivables" | "receivables_fix" | "compliance"
  // Entrega 3: saldo, entradas, saídas e movimentações do estoque (escreve: Estoquista e Gestor; lê com custo: também o Financeiro)
  | "stock_move"
  // Entrega 4: atendimento (lista e custo: Gestor/Financeiro), saldo de pacote dos pacientes e entrega de item de pacote
  | "appt" | "patient_pkg" | "package_deliver"
  // Entrega 5: motor de repasse (regras: Gestor configura, Financeiro consulta; lançamentos: Gestor/Financeiro; recalcular: Gestor/Financeiro)
  | "share_rules" | "share_lines" | "share_recalc"
  // Entrega 6: fechamento mensal (preparar: Gestor/Financeiro; decidir: Gestor; NF e pagamento: Gestor/Financeiro; destravar: só Admin/Owner)
  | "close_prepare" | "close_decide" | "close_pay";

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

/** Aba «Atendimentos»: Admin, Gestor, Financeiro (todos) ou o profissional participante (só os próprios). */
export function canSeeAppointments(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "appt") || a.can.own_appt === true;
}
/** Registrar, realizar, corrigir e cancelar atendimento de qualquer um: Admin e Gestor. O profissional age no PRÓPRIO (o servidor confere a participação). */
export function canManageAppointments(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "appt", "write");
}
/** Registrar o próprio atendimento: Admin/Gestor ou qualquer profissional ativo. */
export function canStartAppointment(a: FinAccess): boolean {
  return canManageAppointments(a) || a.can.own_appt === true;
}
/** Aba «Pacotes dos pacientes»: saldo de sessões e itens (Admin, Gestor, Financeiro e Recepção). */
export function canSeePatientPackages(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "patient_pkg");
}
/** Entregar ao paciente o item de um pacote: Admin, Gestor, Estoquista e Recepção. */
export function canDeliverPackageItem(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "package_deliver", "write");
}

/** Aba «Repasse»: Admin, Gestor, Financeiro (todos os profissionais) ou o profissional com os PRÓPRIOS lançamentos. Recepção e Estoquista não veem. */
export function canSeePayout(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "share_lines") || a.can.own_share === true;
}
/** Todos os profissionais (Admin, Gestor, Financeiro) em vez de só os próprios. */
export function canSeeAllPayouts(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "share_lines");
}
/** Regras de repasse: ver (Admin, Gestor, Financeiro) e configurar (Admin, Gestor). */
export function canSeePayoutRules(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "share_rules");
}
export function canManagePayoutRules(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "share_rules", "write");
}
/** Recalcular o repasse: Admin, Gestor e Financeiro. */
export function canRecalcPayout(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "share_recalc", "write");
}

/** Fechamento mensal (tabela do gestor): Admin, Gestor e Financeiro. */
export function canSeeClosing(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "share_lines");
}
/** Iniciar o fechamento, atualizar os extratos e notificar: Admin, Gestor e Financeiro. */
export function canPrepareClosing(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "close_prepare", "write");
}
/** Aprovar, travar, responder contestação e lançar ajuste manual: Admin e Gestor. */
export function canDecideClosing(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "close_decide", "write");
}
/** Registrar NF e pagamento e baixar o arquivo de pagamento: Admin, Gestor e Financeiro. */
export function canPayClosing(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "close_pay", "write");
}
/** Destravar mês: só o Owner/Admin (com motivo). */
export function canUnlockClosing(a: FinAccess): boolean {
  return a.isAdmin;
}
/** «Meu extrato»: o profissional (clínico) com extrato próprio. */
export function canSeeMyStatement(a: FinAccess): boolean {
  return a.can.own_share === true;
}

export interface FinanceTab { to: string; label: string; end?: boolean }
/** Abas do Financeiro pela matriz de papéis (Entrega 2 inclui Vendas, Títulos e Caixa). */
export function financeTabs(a: FinAccess): FinanceTab[] {
  return [
    ...(a.isAdmin ? [{ to: "/financeiro", label: "Mensalidades", end: true }] : []),
    ...(canSeeSales(a) ? [{ to: "/financeiro/vendas", label: "Vendas" }] : []),
    ...(canSeeAppointments(a) ? [{ to: "/financeiro/atendimentos", label: "Atendimentos" }] : []),
    ...(canSeePatientPackages(a) ? [{ to: "/financeiro/pacotes", label: "Pacotes dos pacientes" }] : []),
    ...(canSeePayout(a) ? [{ to: "/financeiro/repasse", label: "Repasse" }] : []),
    ...(canSeeReceivables(a) ? [{ to: "/financeiro/titulos", label: "Títulos" }] : []),
    ...(canSeeCash(a) ? [{ to: "/financeiro/caixa", label: "Caixa" }] : []),
    ...(canSeeFinanceCadastros(a) || a.isAdmin ? [{ to: "/financeiro/cadastros", label: "Cadastros" }] : []),
  ];
}

/** Item "Financeiro" do menu: admin (Mensalidades) ou quem lê cadastro, vende ou opera caixa. */
export function canSeeFinanceMenu(a: FinAccess): boolean {
  return a.isAdmin || canSeeFinanceCadastros(a) || canSeeSales(a) || canSeeCash(a) || canSeePayout(a);
}

/** Item "Estoque" do menu: admin, gestor, estoquista e financeiro (consulta). */
export function canSeeStockMenu(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "stock_items") || finCan(a, "stock_move");
}

/** Abas Saldo, Entradas, Saídas e Movimentações: quem lê o estoque com custo (Admin, Gestor, Estoquista e Financeiro). */
export function canSeeStockMoves(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "stock_move");
}
/** Lançar entrada, saída e estorno: Admin, Gestor e Estoquista. O Financeiro só consulta; a Recepção e o profissional não entram. */
export function canMoveStock(a: FinAccess): boolean {
  return a.isAdmin || finCan(a, "stock_move", "write");
}

export interface StockTab { to: string; label: string; end?: boolean }
/** Abas do Estoque pela matriz de papéis: Itens (cadastro) + as quatro da Entrega 3 + Consumo sem saldo (Entrega 4). */
export function stockTabs(a: FinAccess): StockTab[] {
  return [
    ...(canSeeStockMoves(a) ? [{ to: "/estoque/saldo", label: "Saldo" }, { to: "/estoque/entradas", label: "Entradas" }, { to: "/estoque/saidas", label: "Saídas" }, { to: "/estoque/movimentacoes", label: "Movimentações" }, { to: "/estoque/sem-saldo", label: "Consumo sem saldo" }] : []),
    ...(a.isAdmin || finCan(a, "stock_items") ? [{ to: "/estoque", label: "Itens", end: true }] : []),
  ];
}

export function rowToAccess(raw: unknown): FinAccess {
  const r = (raw ?? {}) as { is_admin?: boolean; roles?: { role: FinRole; all_units: boolean; unit_ids: string[] }[]; can?: Record<string, boolean> };
  return {
    isAdmin: r.is_admin === true,
    roles: (r.roles ?? []).map((x) => ({ role: x.role, allUnits: x.all_units, unitIds: x.unit_ids ?? [] })),
    can: r.can ?? {},
  };
}
