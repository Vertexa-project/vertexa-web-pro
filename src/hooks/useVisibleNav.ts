import { mainNav, type NavItem } from "@/app/routes";
import { useFinContext } from "@/hooks/useFin";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { canSeeDocsMenu, canSeeFinanceMenu, canSeeStockMenu, NO_FIN_ACCESS, type FinAccess } from "@/lib/domain/finAccess";

/**
 * Itens do menu principal visíveis para quem está logado: adminOnly some para quem não é admin da clínica,
 * EXCETO Financeiro/Estoque, que também aparecem para quem tem papel adicional que alcança a área (matriz de papéis).
 */
export function filterNav(items: NavItem[], isClinicAdmin: boolean, access: FinAccess = NO_FIN_ACCESS): NavItem[] {
  return items.filter((i) => {
    if (!i.adminOnly || isClinicAdmin) return true;
    if (i.finMenu === "finance") return canSeeFinanceMenu(access);
    if (i.finMenu === "stock") return canSeeStockMenu(access);
    if (i.finMenu === "docs") return canSeeDocsMenu(access);
    return false;
  });
}

export function useVisibleMainNav(): NavItem[] {
  const { data: professional } = useCurrentProfessional();
  const { isClinicAdmin } = useIsClinicAdmin(professional?.clinicId ?? null);
  const { access } = useFinContext();
  return filterNav(mainNav, isClinicAdmin, access);
}
