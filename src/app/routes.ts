import {
  Activity,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

// Fonte única do sidebar + rotas (núcleo enxuto do PLANO).
export const mainNav: NavItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/pacientes", label: "Pacientes", icon: Users },
  { path: "/planos", label: "Planos", icon: ClipboardList },
  { path: "/mensagens", label: "Mensagens", icon: MessageSquare },
  { path: "/campanhas", label: "Campanhas", icon: Megaphone },
  { path: "/retencao", label: "Retenção", icon: Activity },
];

export const footerNav: NavItem[] = [
  { path: "/configuracoes", label: "Configurações", icon: Settings },
];
