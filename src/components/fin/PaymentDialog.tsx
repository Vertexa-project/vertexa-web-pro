// Lançar recebimento (escopo-v1 §4.3): forma, maquininha e bandeira (cartão), parcelas, valor e NSU. Mostra os títulos que serão gerados
// quando o papel enxerga as taxas (Recepção lança sem ver taxa; o servidor calcula de qualquer forma).
import { useMemo, useState } from "react";

import { CentsInput, DecimalInput, Field, FormDialog, NativeSelect, TableShell, Td, Th } from "@/components/fin/FinUi";
import { Input } from "@/components/ui/input";
import { useAddPayment, usePaymentOptions } from "@/hooks/useFinSales";
import { formatBRL } from "@/lib/domain/finance";
import { buildTitles, financeSalesErrorMessage, modalityFor, type TitleRule } from "@/lib/domain/finSales";

const br = (iso: string) => iso.split("-").reverse().join("/");

export function PaymentDialog({ clinicId, saleId, unitId, remainingCents, open, onOpenChange }: {
  clinicId: string; saleId: string; unitId: string; remainingCents: number; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const options = usePaymentOptions(clinicId, unitId).data ?? [];
  const add = useAddPayment();
  const [acquirerId, setAcquirerId] = useState("");
  const acq = options.find((o) => o.id === acquirerId) ?? null;
  const [brand, setBrand] = useState("");
  const [cardType, setCardType] = useState<"debit" | "credit">("credit");
  const [installments, setInstallments] = useState<number | null>(1);
  const [amount, setAmount] = useState<number | null>(remainingCents);
  const [nsu, setNsu] = useState("");
  const [error, setError] = useState<string | null>(null);

  const brands = useMemo(() => Array.from(new Set((acq?.rows ?? []).map((r) => r.brand))), [acq]);
  const n = acq?.kind === "machine" ? (cardType === "debit" ? 1 : Math.min(12, Math.max(1, installments ?? 1))) : 1;
  const modality = acq?.kind === "machine" ? modalityFor(cardType, n) : null;
  const titles = useMemo(() => {
    if (!acq || !amount || amount <= 0) return null;
    try {
      if (acq.kind === "machine") {
        const row = acq.rows.find((r) => r.brand === brand && r.modality === modality);
        if (!row || row.fee_pct === null) return null;
        const rule: TitleRule = { kind: "machine", feePct: row.fee_pct, settleDays: row.settle_days ?? 0, anticipation: row.anticipation ?? false, anticipationFeePct: row.anticipation_fee_pct ?? 0, anticipationDays: row.anticipation_days ?? 0 };
        return buildTitles(amount, n, new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }), rule);
      }
      if (acq.flat_fee_pct === null) return null;
      return buildTitles(amount, 1, new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }), { kind: acq.kind, feePct: acq.flat_fee_pct, flatFeeCents: acq.flat_fee_cents ?? 0, settleDays: acq.settle_days ?? 0 });
    } catch { return null; }
  }, [acq, amount, brand, modality, n]);

  function submit() {
    if (!acq) return setError("Escolha a forma de pagamento.");
    if (!amount || amount <= 0) return setError("Informe o valor recebido.");
    if (amount > remainingCents) return setError(`O valor passa do saldo da venda (${formatBRL(remainingCents)}).`);
    if (acq.kind === "machine" && !brand) return setError("Escolha a bandeira.");
    setError(null);
    add.mutate({ saleId, input: { acquirerId: acq.id, brand: acq.kind === "machine" ? brand : null, modality, installments: n, amountCents: amount, nsu: nsu.trim() || undefined } },
      { onSuccess: () => onOpenChange(false), onError: (e) => setError(financeSalesErrorMessage(e)) });
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Lançar recebimento" description={`Saldo da venda: ${formatBRL(remainingCents)}.`} onSubmit={submit} pending={add.isPending} error={error} submitLabel="Lançar recebimento">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Forma de pagamento" htmlFor="pay-acq">
          <NativeSelect id="pay-acq" value={acquirerId} onChange={(e) => { setAcquirerId(e.target.value); setBrand(""); }}>
            <option value="">Selecione…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.kind === "machine" ? `Cartão — ${o.name}` : o.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Valor recebido (R$)" htmlFor="pay-amount"><CentsInput id="pay-amount" value={amount} onChange={setAmount} /></Field>
        {acq?.kind === "machine" ? (
          <>
            <Field label="Bandeira" htmlFor="pay-brand">
              <NativeSelect id="pay-brand" value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value="">Selecione…</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Débito ou crédito" htmlFor="pay-type">
              <NativeSelect id="pay-type" value={cardType} onChange={(e) => setCardType(e.target.value as "debit" | "credit")}>
                <option value="credit">Crédito</option><option value="debit">Débito</option>
              </NativeSelect>
            </Field>
            {cardType === "credit" ? <Field label="Parcelas" htmlFor="pay-n"><DecimalInput id="pay-n" value={installments} onChange={(v) => setInstallments(v === null ? null : Math.round(v))} maxDecimals={0} /></Field> : null}
          </>
        ) : null}
        <Field label="NSU (opcional)" htmlFor="pay-nsu"><Input id="pay-nsu" value={nsu} onChange={(e) => setNsu(e.target.value)} maxLength={40} /></Field>
      </div>
      {titles ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Títulos que serão gerados</p>
          <TableShell label="Prévia dos títulos">
            <thead><tr><Th>Parcela</Th><Th>Bruto</Th><Th>Taxa</Th><Th>Líquido</Th><Th>Previsto para</Th></tr></thead>
            <tbody>{titles.map((t) => (
              <tr key={t.installmentNo}><Td>{t.installmentNo}/{titles.length}</Td><Td className="tabular-nums">{formatBRL(t.grossCents)}</Td><Td className="tabular-nums">{formatBRL(t.feeCents)}</Td><Td className="tabular-nums">{formatBRL(t.netCents)}</Td><Td>{br(t.expectedDate)}</Td></tr>
            ))}</tbody>
          </TableShell>
          <p className="text-xs text-muted-foreground">Prévia; o valor final é calculado pelo sistema com a tabela de taxas da clínica.</p>
        </div>
      ) : null}
    </FormDialog>
  );
}
