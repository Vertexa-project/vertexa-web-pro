import {
  Dumbbell,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  Package,
  MessageSquare,
  BarChart3,
  Wallet,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Item de roadmap: aparece com cadeado, desabilitado (não navega). */
  locked?: boolean;
  /** Só administrador da clínica vê o item (o servidor também nega aos demais). */
  adminOnly?: boolean;
  /**
   * Financeiro/Estoque (Entrega 1): além do admin, também aparece para quem tem papel adicional que alcança a área
   * (matriz de papéis, escopo-v1 §3). Só decide o que MOSTRAR — o servidor recusa o resto.
   */
  finMenu?: "finance" | "stock" | "docs";
}

// Fonte única do sidebar (núcleo enxuto: tudo gira em torno do paciente).
// Removidos da lateral (Review S4):
//  - "Retenção": coortes agora vivem DENTRO do Dashboard (RetentionPanel reutilizável).
//  - "Planos": não é módulo solto — os editores de treino/alimentar vivem na ficha do
//    paciente (WorkoutTab/NutritionTab). As rotas /retencao e /planos seguem montadas em
//    router.tsx (deep-link não quebra), apenas saem do menu.
export const mainNav: NavItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/pacientes", label: "Pacientes", icon: Users },
  { path: "/jornada", label: "Jornada", icon: KanbanSquare },
  { path: "/biblioteca", label: "Biblioteca", icon: Dumbbell },
  { path: "/mensagens", label: "Mensagens", icon: MessageSquare },
  { path: "/campanhas", label: "Campanhas", icon: Megaphone },
  { path: "/gestao", label: "Gestão", icon: BarChart3, adminOnly: true },
  { path: "/financeiro", label: "Financeiro", icon: Wallet, adminOnly: true, finMenu: "finance" },
  { path: "/estoque", label: "Estoque", icon: Package, adminOnly: true, finMenu: "stock" },
  { path: "/documentos", label: "Documentos", icon: FileText, adminOnly: true, finMenu: "docs" },
  // Roadmap (não implementado): modelos de plano/treino/mensagem reutilizáveis.
  // Aparece com cadeado para sinalizar o que vem, sem virar módulo solto.
  { path: "/modelos", label: "Modelos", icon: LayoutTemplate, locked: true },
];

export const footerNav: NavItem[] = [
  { path: "/configuracoes", label: "Configurações", icon: Settings },
];
