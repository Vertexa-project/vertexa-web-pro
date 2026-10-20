import {
  KanbanSquare,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
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
  { path: "/mensagens", label: "Mensagens", icon: MessageSquare },
  { path: "/campanhas", label: "Campanhas", icon: Megaphone },
  { path: "/gestao", label: "Gestão", icon: BarChart3, adminOnly: true },
  { path: "/financeiro", label: "Financeiro", icon: Wallet, adminOnly: true },
  // Roadmap (não implementado): modelos de plano/treino/mensagem reutilizáveis.
  // Aparece com cadeado para sinalizar o que vem, sem virar módulo solto.
  { path: "/modelos", label: "Modelos", icon: LayoutTemplate, locked: true },
];

export const footerNav: NavItem[] = [
  { path: "/configuracoes", label: "Configurações", icon: Settings },
];
