import { Link } from "react-router-dom";

import { PlatformBillingClinicsPage } from "./PlatformBillingClinicsPage";

export function PlatformBillingPixPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Reemissão de Pix recusado continua em{" "}
        <Link to="/platform/clinicas" className="text-primary underline-offset-4 hover:underline">
          Clínicas
        </Link>
        . ACTIVE não reemite. INTENT aguarda criação. CREATED aguarda o banco do cliente.
      </p>
      <PlatformBillingClinicsPage
        title="Pix Automático"
        description="Estado, geração e contrato. Recusado não é o mesmo que inadimplente."
      />
    </div>
  );
}
