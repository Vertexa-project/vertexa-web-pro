import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CONSENT_CHECKBOX_LABEL, CONSENT_TEXT, CONSENT_VERSION } from "@/lib/clinical/consent";

/** Aceite obrigatório antes de gravar. Sem aceite só dá para preencher à mão. */
export function ConsentCard({ onConfirm, error }: { onConfirm: (version: string, text: string) => Promise<void>; error: string | null }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(CONSENT_VERSION, CONSENT_TEXT);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Aceite do paciente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{CONSENT_TEXT}</p>
        <label className="flex items-start gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>{CONSENT_CHECKBOX_LABEL}</span>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={confirm} disabled={!checked || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Registrar aceite
          </Button>
          <span className="text-xs text-muted-foreground">Sem o aceite, o prontuário pode ser preenchido à mão.</span>
        </div>
      </CardContent>
    </Card>
  );
}
