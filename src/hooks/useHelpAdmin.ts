import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getAdminHelp,
  getHelpSettings,
  saveAdminArticle,
  saveAdminCategory,
  saveHelpSettings,
} from "@/lib/api/helpAdmin";

export const helpAdminKeys = {
  all: ["help-admin"] as const,
  data: ["help-admin", "data"] as const,
  settings: ["help-center", "settings"] as const,
};

export function useAdminHelp() {
  return useQuery({ queryKey: helpAdminKeys.data, queryFn: getAdminHelp });
}

export function useHelpSettings(enabled = true) {
  return useQuery({ queryKey: helpAdminKeys.settings, queryFn: getHelpSettings, enabled, staleTime: 5 * 60_000 });
}

function useInvalidateHelp() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: helpAdminKeys.all });
    void qc.invalidateQueries({ queryKey: ["help-center"] });
  };
}

export function useSaveAdminArticle() {
  const invalidate = useInvalidateHelp();
  return useMutation({ mutationFn: saveAdminArticle, onSuccess: invalidate });
}

export function useSaveAdminCategory() {
  const invalidate = useInvalidateHelp();
  return useMutation({ mutationFn: saveAdminCategory, onSuccess: invalidate });
}

export function useSaveHelpSettings() {
  const invalidate = useInvalidateHelp();
  return useMutation({ mutationFn: saveHelpSettings, onSuccess: invalidate });
}
