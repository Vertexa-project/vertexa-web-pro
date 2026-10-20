import { useQuery } from "@tanstack/react-query";

import { clinicLogoUrl, getMyClinicBrand } from "@/lib/api/clinicBrand";

export const CLINIC_BRAND_KEY = ["clinicBrand", "mine"] as const;

/** Marca (nome + logo + cor) da clínica do logado, com URL pública da logo já resolvida. */
export const useClinicBrand = () =>
  useQuery({
    queryKey: CLINIC_BRAND_KEY,
    queryFn: async () => {
      const b = await getMyClinicBrand();
      return b ? { ...b, logoUrl: clinicLogoUrl(b.logoPath) } : null;
    },
    staleTime: 5 * 60 * 1000,
  });
