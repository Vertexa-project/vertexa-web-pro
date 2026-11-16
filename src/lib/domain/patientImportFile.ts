// Leitura do arquivo de importação: CSV (UTF-8 ou Windows-1252) e XLSX. Sem dependência nova: o .xlsx é um zip de XML lido com `fflate`
// e DOMParser. Nada é executado: célula que começa com = + - @ continua texto. O tamanho declarado do zip é conferido ANTES de extrair.
import { unzipSync, strFromU8 } from "fflate";

import {
  IMPORT_MAX_COLS,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  parseDelimited,
  type RawImportRow,
} from "@/lib/domain/patientImport";

/** Limite do que o .xlsx pode ocupar depois de aberto (proteção contra zip bomb). */
export const IMPORT_MAX_XLSX_UNCOMPRESSED = 30 * 1024 * 1024;

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

export interface ParsedImportFile {
  filename: string;
  headers: string[];
  rows: RawImportRow[];
}

// ---------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------

function xml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new ImportFileError("A planilha está corrompida ou não é um .xlsx válido.");
  return doc;
}

/** "B3" → índice de coluna 1 (A=0). */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const textOf = (el: Element): string => Array.from(el.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");

/** Formatos de data embutidos do Excel (14–22, 45–47) e os personalizados que têm d/m/a. */
function isDateFormat(id: number, code: string | undefined): boolean {
  if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
  if (!code) return false;
  const c = code.toLowerCase().replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /[dmy]/.test(c) && !/[#0]/.test(c);
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

export function readXlsx(buf: Uint8Array): string[][] {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, {
      filter: (f) => {
        total += f.originalSize;
        if (total > IMPORT_MAX_XLSX_UNCOMPRESSED) throw new ImportFileError("A planilha é grande demais depois de aberta.");
        return /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof ImportFileError) throw e;
    throw new ImportFileError("Não consegui abrir este arquivo como .xlsx. Salve a planilha como .xlsx ou .csv e tente de novo.");
  }
  if (!files["xl/workbook.xml"]) throw new ImportFileError("Não consegui abrir este arquivo como .xlsx. Salve a planilha como .xlsx ou .csv e tente de novo.");

  // primeira aba, pela ordem do workbook
  const wb = xml(strFromU8(files["xl/workbook.xml"]));
  const rid = wb.getElementsByTagName("sheet")[0]?.getAttribute("r:id");
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (rid && files["xl/_rels/workbook.xml.rels"]) {
    const rels = xml(strFromU8(files["xl/_rels/workbook.xml.rels"]));
    const rel = Array.from(rels.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid);
    const target = rel?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  if (!files[sheetPath]) {
    sheetPath = Object.keys(files).filter((k) => k.startsWith("xl/worksheets/")).sort()[0] ?? "";
    if (!sheetPath) throw new ImportFileError("A planilha não tem nenhuma aba com dados.");
  }

  const shared: string[] = files["xl/sharedStrings.xml"]
    ? Array.from(xml(strFromU8(files["xl/sharedStrings.xml"])).getElementsByTagName("si")).map(textOf)
    : [];

  // estilos que são data
  const dateStyle = new Set<number>();
  if (files["xl/styles.xml"]) {
    const st = xml(strFromU8(files["xl/styles.xml"]));
    const codes = new Map<number, string>();
    for (const n of Array.from(st.getElementsByTagName("numFmt"))) codes.set(Number(n.getAttribute("numFmtId")), n.getAttribute("formatCode") ?? "");
    const xfs = st.getElementsByTagName("cellXfs")[0];
    Array.from(xfs?.getElementsByTagName("xf") ?? []).forEach((xf, i) => {
      const id = Number(xf.getAttribute("numFmtId") ?? 0);
      if (isDateFormat(id, codes.get(id))) dateStyle.add(i);
    });
  }

  const sheet = xml(strFromU8(files[sheetPath]));
  const out: string[][] = [];
  for (const rowEl of Array.from(sheet.getElementsByTagName("row"))) {
    const rowNum = Number(rowEl.getAttribute("r") ?? out.length + 1);
    const cells: string[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r") ?? "";
      const idx = ref ? colIndex(ref) : cells.length;
      if (idx >= IMPORT_MAX_COLS * 2) continue;
      const t = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let value = "";
      if (t === "s") value = shared[Number(v)] ?? "";
      else if (t === "inlineStr") value = textOf(c);
      else if (t === "b") value = v === "1" ? "Sim" : "Não";
      else if (t === "str" || t === "e") value = v;
      else if (v !== "") {
        const num = Number(v);
        const style = Number(c.getAttribute("s") ?? 0);
        value = dateStyle.has(style) ? (excelSerialToIso(num) ?? v) : v;
      }
      while (cells.length < idx) cells.push("");
      cells[idx] = value;
    }
    while (out.length < rowNum - 1) out.push([]);
    out[rowNum - 1] = cells;
  }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------------------------------------
// Arquivo → cabeçalho + linhas
// ---------------------------------------------------------------------------------------------

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // exportações antigas do Dietbox/Excel vêm em ANSI
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Transforma uma matriz (primeira linha = cabeçalho) em arquivo lido, aplicando os limites. */
export function sheetToImportFile(filename: string, matrix: string[][]): ParsedImportFile {
  if (matrix.length === 0) throw new ImportFileError("O arquivo está vazio.");
  const [headerRow, ...body] = matrix;
  if (headerRow.length > IMPORT_MAX_COLS) throw new ImportFileError(`O arquivo tem ${headerRow.length} colunas; o limite é ${IMPORT_MAX_COLS}.`);
  if (body.length === 0) throw new ImportFileError("O arquivo só tem o cabeçalho, sem nenhum paciente.");
  if (body.length > IMPORT_MAX_ROWS) {
    throw new ImportFileError(`O arquivo tem ${body.length} linhas; o limite é ${IMPORT_MAX_ROWS} por importação. Divida em partes.`);
  }
  // linha na planilha: cabeçalho = 1; linhas vazias já saíram, então só renumera quando o leitor preservou a posição
  const rows: RawImportRow[] = body.map((cells, i) => ({ line: i + 2, cells: cells.map((c) => c ?? "") }));
  return { filename, headers: headerRow.map((h) => (h ?? "").trim()), rows };
}

export async function readImportFile(file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<ParsedImportFile> {
  if (file.size > IMPORT_MAX_FILE_BYTES) throw new ImportFileError("O arquivo passa de 5 MB. Divida a planilha em partes menores.");
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xls")) throw new ImportFileError("Arquivo .xls antigo não é lido. Abra no Excel e salve como .xlsx ou .csv.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (lower.endsWith(".xlsx")) return sheetToImportFile(file.name, readXlsx(bytes));
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    // um .csv que na verdade é zip (xlsx renomeado)
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return sheetToImportFile(file.name, readXlsx(bytes));
    return sheetToImportFile(file.name, parseDelimited(decodeText(bytes)));
  }
  throw new ImportFileError("Use um arquivo .csv ou .xlsx.");
}
