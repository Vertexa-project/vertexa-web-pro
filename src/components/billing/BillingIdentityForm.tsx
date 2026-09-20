import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClinicBillingIdentity, useUpsertClinicBillingIdentity } from "@/hooks/useBillingProfile";
import {
  billingProfileErrorMessage,
  isExpectedBillingProfileError,
  maskTaxId,
  validateBillingEmail,
  validateBillingPhone,
  validateLegalName,
  validateTaxId,
} from "@/lib/domain/billingProfile";
import { captureException } from "@/lib/observability/sentry";

export function BillingIdentityForm({
  clinicId,
  onComplete,
}: {
  clinicId: string;
  onComplete?: () => void;
}) {
  const profile = useClinicBillingIdentity(clinicId, true);
  const save = useUpsertClinicBillingIdentity(clinicId);
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const identity = profile.data;
  useEffect(() => {
    if (!identity) return;
    setLegalName(identity.legalName ?? "");
    setTaxId(identity.taxId ?? "");
    setEmail(identity.email ?? "");
    setPhone(identity.mobilePhone ?? "");
    setEditing(!identity.exists);
  }, [identity]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nameCheck = validateLegalName(legalName);
    if (!nameCheck.ok) {
      setFormError(nameCheck.message);
      return;
    }
    const taxCheck = validateTaxId(taxId);
    if (!taxCheck.ok) {
      setFormError(taxCheck.message);
      return;
    }
    const emailCheck = validateBillingEmail(email);
    if (!emailCheck.ok) {
      setFormError(emailCheck.message);
      return;
    }
    const phoneCheck = validateBillingPhone(phone);
    if (!phoneCheck.ok) {
      setFormError(phoneCheck.message);
      return;
    }

    setFormError(null);
    setSaved(false);
    save.mutate(
      {
        legalName: nameCheck.value,
        taxId: taxCheck.value,
        email: emailCheck.value,
        mobilePhone: phoneCheck.value,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setEditing(false);
          onComplete?.();
        },
        onError: (err) => {
          setFormError(billingProfileErrorMessage(err));
          if (!isExpectedBillingProfileError(err)) {
            captureException(err, { source: "billing", scope: "billing-identity" });
          }
        },
      },
    );
  }

  const showMasked = Boolean(profile.data?.exists) && !editing;
  const busy = save.isPending || profile.isLoading;

  if (profile.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando…
      </p>
    );
  }

  if (profile.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar os dados de cobrança.
      </p>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="billing-legal-name">Razão social / nome legal</Label>
        <Input
          id="billing-legal-name"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          autoComplete="organization"
          disabled={busy || showMasked}
          aria-required="true"
          aria-invalid={Boolean(formError)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="billing-tax-id">CPF/CNPJ</Label>
        {showMasked ? (
          <p id="billing-tax-id" className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
            {profile.data?.taxIdMasked ?? maskTaxId(taxId)}
          </p>
        ) : (
          <Input
            id="billing-tax-id"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            disabled={busy}
            aria-required="true"
            aria-invalid={Boolean(formError)}
          />
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="billing-email">E-mail de cobrança</Label>
        <Input
          id="billing-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={busy || showMasked}
          aria-required="true"
          aria-invalid={Boolean(formError)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="billing-phone">Telefone (opcional)</Label>
        <Input
          id="billing-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          disabled={busy || showMasked}
        />
      </div>

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-foreground">
          Dados de cobrança salvos.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {showMasked ? (
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            Editar
          </Button>
        ) : (
          <Button type="submit" disabled={busy}>
            {save.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Salvando…
              </>
            ) : (
              "Salvar dados de cobrança"
            )}
          </Button>
        )}
      </div>
    </form>
  );
}
