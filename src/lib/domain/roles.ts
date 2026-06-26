// RBAC de UI (Sessão 7) — papel do profissional logado controla o que VÊ/EDITA na interface.
// ⚠️ Isto é gating de UI, NÃO autorização real. A barreira de verdade é a RLS por papel/clínica
// no banco (dívida #11–#14 / Sessão 9). Nunca confiar só no "botão escondido".
//
// Papel efetivo deriva de profiles.role (admin|professional) + professionals.type
// (doctor|nutritionist|personal_trainer|physiotherapist|other).
import type { ProfessionalType, UserRole } from "@/types/db";

export type Role = "admin" | "doctor" | "nutritionist" | "trainer" | "physio" | "other";

export interface RolePermissions {
  /** Gestão administrativa da clínica, como Financeiro futuro. */
  isAdmin: boolean;
  /** Edita o Plano alimentar (nutricionista). */
  canEditNutrition: boolean;
  /** Edita o Treino (médico / personal trainer). */
  canEditWorkout: boolean;
}

// Admin = gestão (vê itens de clínica; NÃO edita planos clínicos). Cada clínico edita só o seu.
const PERMISSIONS: Record<Role, RolePermissions> = {
  admin: { isAdmin: true, canEditNutrition: false, canEditWorkout: false },
  doctor: { isAdmin: false, canEditNutrition: false, canEditWorkout: true },
  nutritionist: { isAdmin: false, canEditNutrition: true, canEditWorkout: false },
  trainer: { isAdmin: false, canEditNutrition: false, canEditWorkout: true },
  physio: { isAdmin: false, canEditNutrition: false, canEditWorkout: false },
  other: { isAdmin: false, canEditNutrition: false, canEditWorkout: false },
};

const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador(a)",
  doctor: "Médico(a)",
  nutritionist: "Nutricionista",
  trainer: "Personal trainer",
  physio: "Fisioterapeuta",
  other: "Profissional",
};

const TYPE_TO_ROLE: Record<ProfessionalType, Role> = {
  doctor: "doctor",
  nutritionist: "nutritionist",
  personal_trainer: "trainer",
  physiotherapist: "physio",
  other: "other",
};

/** Papel efetivo: admin (pelo profile.role) tem precedência; senão, deriva do tipo do profissional. */
export function deriveRole(profileRole: UserRole | null | undefined, type: ProfessionalType | null | undefined): Role {
  if (profileRole === "admin") return "admin";
  if (type) return TYPE_TO_ROLE[type] ?? "other";
  return "other";
}

export function permissionsFor(role: Role): RolePermissions {
  return PERMISSIONS[role];
}

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

/** Motivos PT-BR de bloqueio de edição (mostrados quando a ação fica desabilitada). */
export const EDIT_REASON = {
  nutrition: "Apenas o nutricionista edita o plano alimentar.",
  workout: "Apenas o médico ou personal trainer edita o treino.",
  calendar: "Apenas o administrador da clínica gerencia a integração com o Google Calendar.",
} as const;

/** Papéis oferecidos no seletor de DEMONSTRAÇÃO (personas demonstráveis ao vivo). */
export const DEMO_ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "doctor", label: "Médico(a)" },
  { value: "nutritionist", label: "Nutri" },
];
