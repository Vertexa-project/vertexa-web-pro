import {
  BarChart3,
  CalendarDays,
  Dumbbell,
  Home,
  KanbanSquare,
  MessageSquare,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import { pathMatches } from "@/lib/domain/gestaoNav";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Item de roadmap: aparece com cadeado, desabilitado (não navega). */
  locked?: boolean;
  /** Outros caminhos que mantêm o item ativo (rotas antigas continuam montadas: deep link não quebra). */
  alsoActiveOn?: string[];
  /**
   * Item «Gestão»: agrupa Visão geral, Financeiro, Estoque e Documentos. Aparece para quem tem ao menos uma sub-aba
   * (mesma regra de papéis de antes: admin da clínica ou papel que alcança a área) e navega para a primeira delas.
   */
  gestao?: boolean;
}

// Fonte única do menu (redesign P2 — ordem do guia, seção "Mapa do app"). «Vertexa IA» não é rota: é o painel lateral (VertexaAiButton no topo do menu e na barra superior).
// As rotas /retencao, /planos, /mensagens, /campanhas, /financeiro/*, /estoque/*, /documentos seguem
// montadas em router.tsx — só saíram do menu (deep link não quebra).
export const mainNav: NavItem[] = [
  { path: "/", label: "Hoje", icon: Home },
  { path: "/pacientes", label: "Pacientes", icon: Users },
  { path: "/agenda", label: "Agenda", icon: CalendarDays },
  { path: "/jornada", label: "Jornada", icon: KanbanSquare },
  { path: "/relacionamento", label: "Relacionamento", icon: MessageSquare, alsoActiveOn: ["/mensagens", "/campanhas"] },
  {
    path: "/gestao",
    label: "Gestão",
    icon: BarChart3,
    gestao: true,
    alsoActiveOn: ["/financeiro", "/estoque", "/documentos"],
  },
  { path: "/biblioteca", label: "Biblioteca", icon: Dumbbell },
  // "Modelos" (roadmap) fica FORA do menu até ficar pronto (redesign P1 · item 8).
];

export const footerNav: NavItem[] = [
  { path: "/configuracoes", label: "Configurações", icon: Settings },
];

/** O item está ativo para este caminho? (rota própria, sub-rotas ou rotas antigas agrupadas) */
export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.path === "/") return pathname === "/";
  return [item.path, ...(item.alsoActiveOn ?? [])].some((p) => pathMatches(pathname, p));
}
