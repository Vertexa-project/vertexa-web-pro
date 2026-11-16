import { mainNav, type NavItem } from "@/app/routes";
import { useFinContext } from "@/hooks/useFin";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { NO_FIN_ACCESS, type FinAccess } from "@/lib/domain/finAccess";
import { gestaoTabs } from "@/lib/domain/gestaoNav";

/**
 * Itens do menu principal visíveis para quem está logado. «Gestão» agrupa Visão geral (só admin) + Financeiro/Estoque/
 * Documentos (admin OU papel que alcança a área — matriz de papéis): aparece para quem tem ao menos uma sub-aba e
 * navega para a primeira. Só decide o que MOSTRAR — o servidor recusa o resto.
 */
export function filterNav(items: NavItem[], isClinicAdmin: boolean, access: FinAccess = NO_FIN_ACCESS): NavItem[] {
  const tabs = gestaoTabs(isClinicAdmin, access);
  return items.flatMap((i) => {
    if (!i.gestao) return [i];
    return tabs.length === 0 ? [] : [{ ...i, path: tabs[0].to }];
  });
}

export function useVisibleMainNav(): NavItem[] {
  const { data: professional } = useCurrentProfessional();
  const { isClinicAdmin } = useIsClinicAdmin(professional?.clinicId ?? null);
  const { access } = useFinContext();
  return filterNav(mainNav, isClinicAdmin, access);
}
