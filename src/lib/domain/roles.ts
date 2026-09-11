// RBAC ADMINISTRATIVO de UI (admin da clínica) + rótulo/persona de DISPLAY.
// ⚠️ O gating CLÍNICO (dieta/treino/avaliação/suplementos) NÃO vive mais aqui: vem das DISCIPLINAS do
// profissional (WP-DISC B) — ver src/lib/domain/disciplines.ts + useDisciplinePermissions. Aqui só
// resta o que é ADMINISTRATIVO (isAdmin, ex.: calendário/administração de disciplinas) e o RÓTULO de
// display. `professionals.type` é usado APENAS para o rótulo de display (deriveRole/roleLabel) e para
// listar a equipe — NUNCA para permissão clínica.
// Gating de UI, não autorização — a barreira real é a RLS por papel/clínica/disciplina no banco.
import type { ProfessionalType, UserRole } from "@/types/db";

export type Role = "admin" | "doctor" | "nutritionist" | "trainer" | "physio" | "other";

export interface RolePermissions {
  /** Gestão administrativa da clínica (ex.: equipe, disciplinas, jornada). Calendar pessoal NÃO usa isto. */
  isAdmin: boolean;
}

// Só administrativo. admin = gestão; os demais papéis não são admin (a autoridade clínica é a disciplina).
const PERMISSIONS: Record<Role, RolePermissions> = {
  admin: { isAdmin: true },
  doctor: { isAdmin: false },
  nutritionist: { isAdmin: false },
  trainer: { isAdmin: false },
  physio: { isAdmin: false },
  other: { isAdmin: false },
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

/**
 * Papel de DISPLAY/administrativo. admin (profiles.role) tem precedência; senão deriva do tipo do
 * profissional APENAS para o RÓTULO de display — NÃO define permissão clínica (isso vem das disciplinas).
 */
export function deriveRole(
  profileRole: UserRole | null | undefined,
  type: ProfessionalType | null | undefined,
): Role {
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

/**
 * Motivo PT-BR quando o caller não tem cadastro profissional ativo (Google Calendar pessoal).
 * Os motivos CLÍNICOS por disciplina vivem em `DISCIPLINE_REASON`.
 */
export const EDIT_REASON = {
  calendar: "Conecte com um cadastro profissional ativo para gerenciar a sua Google Agenda.",
} as const;
