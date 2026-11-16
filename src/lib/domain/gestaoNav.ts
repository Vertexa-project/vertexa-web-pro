import { canSeeDocsMenu, canSeeFinanceMenu, canSeeStockMenu, NO_FIN_ACCESS, type FinAccess } from "@/lib/domain/finAccess";

export interface SectionTab {
  /** Destino da sub-aba (rota que já existia). */
  to: string;
  label: string;
  /** Prefixos de caminho que mantêm a sub-aba ativa (ex.: /financeiro/vendas → Financeiro). */
  match: string[];
}

/**
 * Sub-abas do item «Gestão» (redesign P2). A visibilidade é a MESMA regra do menu anterior — só decide o que MOSTRAR
 * (o servidor recusa o resto): Visão geral = só admin da clínica; Financeiro/Estoque/Documentos = admin OU papel
 * que alcança a área (finMenu). O item Gestão aparece para quem tiver ao menos uma sub-aba.
 */
export function gestaoTabs(isClinicAdmin: boolean, access: FinAccess = NO_FIN_ACCESS): SectionTab[] {
  const tabs: SectionTab[] = [];
  if (isClinicAdmin) tabs.push({ to: "/gestao", label: "Visão geral", match: ["/gestao"] });
  if (isClinicAdmin || canSeeFinanceMenu(access)) tabs.push({ to: "/financeiro", label: "Financeiro", match: ["/financeiro"] });
  if (isClinicAdmin || canSeeStockMenu(access)) tabs.push({ to: "/estoque", label: "Estoque", match: ["/estoque"] });
  if (isClinicAdmin || canSeeDocsMenu(access)) tabs.push({ to: "/documentos", label: "Documentos", match: ["/documentos"] });
  return tabs;
}

/** Sub-abas de «Relacionamento». As rotas antigas (/mensagens, /campanhas) seguem montadas e mantêm a aba ativa. */
export const RELACIONAMENTO_TABS: SectionTab[] = [
  { to: "/relacionamento", label: "Mensagens", match: ["/relacionamento/mensagens", "/mensagens"] },
  { to: "/relacionamento/campanhas", label: "Campanhas", match: ["/relacionamento/campanhas", "/campanhas"] },
];

/** `/financeiro` ativa a sub-aba `/financeiro`; `/financeiros` não. */
export function pathMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function activeSectionTab(tabs: SectionTab[], pathname: string): SectionTab | null {
  // /relacionamento (index) é Mensagens; /relacionamento/campanhas não pode cair em /relacionamento.
  const exact = tabs.find((t) => t.match.some((m) => pathMatches(pathname, m)) && t.to !== "/relacionamento");
  if (exact) return exact;
  return tabs.find((t) => t.match.some((m) => pathMatches(pathname, m))) ?? (pathname === "/relacionamento" ? tabs[0] ?? null : null);
}
