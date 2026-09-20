// CSV de produto — não concatenar strings no React.
// UTF-8, escaping RFC-like, e neutralização de fórmula de planilha.

export const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"] as const;
export const BILLING_CSV_MAX_EXPORT_ROWS = 500;

export type CsvCell = string | number | null | undefined;

export function neutralizeSpreadsheetFormula(value: string): string {
  if (value.length === 0) return value;
  const first = value[0];
  if (
    first === "=" ||
    first === "+" ||
    first === "-" ||
    first === "@" ||
    first === "\t" ||
    first === "\r"
  ) {
    return `'${value}`;
  }
  return value;
}

export function escapeCsvCell(value: CsvCell, options: { numeric?: boolean } = {}): string {
  if (value == null) return "";
  if (options.numeric && typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  const text = neutralizeSpreadsheetFormula(String(value));
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [
    headers.map((header) => escapeCsvCell(header)).join(","),
    ...rows.map((row) =>
      row
        .map((cell, index) =>
          escapeCsvCell(cell, { numeric: typeof cell === "number" && typeof headers[index] === "string" }),
        )
        .join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function billingCsvFilename(kind: string, periodStart: string, periodEnd: string): string {
  const safeKind = kind.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "pagamentos";
  const start = periodStart.replace(/-/g, "");
  const end = periodEnd.replace(/-/g, "");
  return `vertexa-faturamento-${safeKind}-${start}-${end}.csv`;
}

export function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
