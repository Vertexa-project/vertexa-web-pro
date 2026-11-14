import { pdf } from "@react-pdf/renderer";

import { ClosingPdf, StatementPdf } from "./ClosingPdf";
import type { ClosingTotals, StatementView } from "@/lib/api/finClosing";
import { statementItems, type ClosingRow } from "@/lib/domain/finClosing";
import { PAYOUT_ROLE_LABEL } from "@/lib/domain/finPayout";

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadClosingPdf(period: string, rows: ClosingRow[], totals: ClosingTotals): Promise<void> {
  save(await pdf(<ClosingPdf period={period} rows={rows} totals={totals} />).toBlob(), `fechamento-${period}.pdf`);
}

export async function downloadStatementPdf(v: StatementView): Promise<void> {
  const items = statementItems(v.lines, v.derived, v.withholdings, (r) => PAYOUT_ROLE_LABEL[r as keyof typeof PAYOUT_ROLE_LABEL] ?? r);
  const slug = v.professional.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
  save(await pdf(<StatementPdf v={v} items={items} />).toBlob(), `extrato-${slug}-${v.closing.period}.pdf`);
}
