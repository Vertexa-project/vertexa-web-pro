// Exportação CSV e XLSX de toda tabela nova (escopo-v1 §3). Sem dependência nova: o XLSX é montado com `fflate`
// (já usado no app) — um .xlsx é um zip de XML; células de texto inline, dinheiro/quantidade como número formatado.
import { strToU8, zipSync } from "fflate";

import { formatDecimalBR } from "./money";

export type ExportKind = "text" | "money" | "qty" | "pct" | "unitcost";

export interface ExportColumn<T> {
  header: string;
  /** money: CENTAVOS (inteiro); qty: número (até 3 casas); pct: número; text: string. */
  value: (row: T) => string | number | boolean | null | undefined;
  kind?: ExportKind;
}

type Cell = string | number | null;

function cellOf(raw: string | number | boolean | null | undefined, kind: ExportKind): Cell {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "boolean") return raw ? "Sim" : "Não";
  if (kind === "money") return Math.round(Number(raw)) / 100;
  if (kind === "qty" || kind === "pct") return Number(raw);
  if (kind === "unitcost") return Math.round(Number(raw) * 10000) / 10000; // R$ por unidade, 4 casas fixas, sem ruído de ponto flutuante
  return String(raw);
}

function csvEscape(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV para Excel pt-BR: separador `;`, vírgula decimal, BOM UTF-8. Dinheiro sempre com 2 casas; quantidade com até 3. */
export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const fmt = (c: Cell, kind: ExportKind): string => {
    if (c === null) return "";
    if (typeof c === "number") {
      if (kind === "money") return formatDecimalBR(c, 2).replace(/\./g, "");
      if (kind === "unitcost") return c.toFixed(4).replace(".", ",");
      return String(c).replace(".", ",");
    }
    return csvEscape(c);
  };
  const lines = [columns.map((c) => csvEscape(c.header)).join(";")];
  for (const row of rows) {
    lines.push(columns.map((c) => fmt(cellOf(c.value(row), c.kind ?? "text"), c.kind ?? "text")).join(";"));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch] as string);

function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Estilos: 0 padrão · 1 cabeçalho em negrito · 2 dinheiro 0,00 · 3 quantidade 0,000 (até 3 casas). */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.###"/><numFmt numFmtId="166" formatCode="#,##0.0000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;

export function toXlsx<T>(columns: ExportColumn<T>[], rows: T[], sheetName = "Dados"): Uint8Array {
  const sheetRows: string[] = [];
  const head = columns.map((c, i) => `<c r="${colName(i)}1" s="1" t="inlineStr"><is><t>${xmlEscape(c.header)}</t></is></c>`).join("");
  sheetRows.push(`<row r="1">${head}</row>`);
  rows.forEach((row, ri) => {
    const r = ri + 2;
    const cells = columns
      .map((c, ci) => {
        const kind = c.kind ?? "text";
        const v = cellOf(c.value(row), kind);
        if (v === null) return "";
        const ref = `${colName(ci)}${r}`;
        if (typeof v === "number") return `<c r="${ref}" s="${kind === "money" ? 2 : kind === "qty" ? 3 : kind === "unitcost" ? 4 : 0}"><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
      })
      .join("");
    sheetRows.push(`<row r="${r}">${cells}</row>`);
  });
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.join("")}</sheetData></worksheet>`;
  const safeName = xmlEscape(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Dados");
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}

/** Dispara o download no navegador. */
export function downloadBlob(data: BlobPart, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const CSV_MIME = "text/csv;charset=utf-8";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
