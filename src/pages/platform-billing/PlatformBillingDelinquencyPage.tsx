import { PlatformBillingClinicsPage } from "./PlatformBillingClinicsPage";

export function PlatformBillingDelinquencyPage() {
  return (
    <PlatformBillingClinicsPage
      title="Inadimplência"
      description="Só entra aqui quem tem cobrança vencida. Pix recusado, sozinho, não suspende nem marca atraso."
      preset={{ financialStatus: "overdue", needsAttention: true }}
    />
  );
}
