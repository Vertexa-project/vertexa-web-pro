import { pdf } from "@react-pdf/renderer";

import { StockReportPdf } from "./StockReportPdf";
import type { ReportColumn, Row } from "@/lib/domain/stockReports";

export async function downloadStockReportPdf(args: { filename: string; title: string; subtitle: string; columns: ReportColumn[]; rows: Row[]; totals: string[] }): Promise<void> {
  const blob = await pdf(<StockReportPdf title={args.title} subtitle={args.subtitle} columns={args.columns} rows={args.rows} totals={args.totals} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${args.filename}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
