import { mainNav, type NavItem } from "@/app/routes";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";

/** Itens do menu principal visíveis para quem está logado (adminOnly some para quem não é admin da clínica). */
export function filterNav(items: NavItem[], isClinicAdmin: boolean): NavItem[] {
  return items.filter((i) => !i.adminOnly || isClinicAdmin);
}

export function useVisibleMainNav(): NavItem[] {
  const { data: professional } = useCurrentProfessional();
  const { isClinicAdmin } = useIsClinicAdmin(professional?.clinicId ?? null);
  return filterNav(mainNav, isClinicAdmin);
}
