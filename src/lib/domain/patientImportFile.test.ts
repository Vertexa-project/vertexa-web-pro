import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { IMPORT_MAX_COLS, IMPORT_MAX_FILE_BYTES, IMPORT_MAX_ROWS } from "./patientImport";
import {
  IMPORT_MAX_XLSX_UNCOMPRESSED,
  ImportFileError,
  readImportFile,
  readXlsx,
  sheetToImportFile,
} from "./patientImportFile";
import { toXlsx } from "./tableExport";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** .xlsx no formato do Excel: textos em sharedStrings, datas como número + estilo de data. */
function excelStyleXlsx(): Uint8Array {
  const shared = ["Nome do Paciente", "Data de Nascimento", "Celular", "Peso (kg)", "Ana Souza", "=1+1", "(17) 9 9812-3344"];
  const sheet = `<?xml version="1.0"?><worksheet ${NS}><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
    <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" s="1"><v>33003</v></c><c r="C2" t="s"><v>6</v></c><c r="D2"><v>70.5</v></c></row>
    <row r="3"><c r="A3" t="s"><v>5</v></c><c r="C3"><v>17998012201</v></c></row>
  </sheetData></worksheet>`;
  const styles = `<?xml version="1.0"?><styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
    <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="Pacientes" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0"?><sst ${NS}>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
    "xl/styles.xml": strToU8(styles),
  });
}

const fileOf = (name: string, bytes: Uint8Array | string) => {
  const u8 = typeof bytes === "string" ? strToU8(bytes) : bytes;
  return { name, size: u8.byteLength, arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer };
};

describe("readXlsx", () => {
  it("lê planilha no formato do Excel: textos compartilhados, número de telefone, data pelo estilo", () => {
    const m = readXlsx(excelStyleXlsx());
    expect(m[0]).toEqual(["Nome do Paciente", "Data de Nascimento", "Celular", "Peso (kg)"]);
    expect(m[1]).toEqual(["Ana Souza", "1990-05-10", "(17) 9 9812-3344", "70.5"]);
    // fórmula digitada como texto continua texto
    expect(m[2][0]).toBe("=1+1");
    expect(m[2][2]).toBe("17998012201");
  });
  it("lê o xlsx gerado pelo próprio app (texto inline)", () => {
    const bytes = toXlsx(
      [
        { header: "Nome", value: (r: string[]) => r[0] },
        { header: "E-mail", value: (r: string[]) => r[1] },
      ],
      [["Bruno", "bruno@x.com"]],
    );
    expect(readXlsx(bytes)).toEqual([["Nome", "E-mail"], ["Bruno", "bruno@x.com"]]);
  });
  it("arquivo que não é zip dá mensagem em português, nunca erro técnico", () => {
    expect(() => readXlsx(strToU8("isto não é uma planilha"))).toThrowError(/Não consegui abrir/);
  });
  it("zip sem planilha dentro é recusado", () => {
    expect(() => readXlsx(zipSync({ "arquivo.txt": strToU8("oi") }))).toThrowError(ImportFileError);
  });
  it("recusa pelo tamanho declarado depois de aberto, sem extrair (limite no valor exato)", () => {
    const big = (n: number) => zipSync({ "xl/workbook.xml": strToU8("<workbook/>"), "xl/worksheets/sheet1.xml": new Uint8Array(n) });
    expect(() => readXlsx(big(IMPORT_MAX_XLSX_UNCOMPRESSED))).toThrowError(/grande demais/);
    expect(() => readXlsx(big(IMPORT_MAX_XLSX_UNCOMPRESSED - 1000))).not.toThrowError(/grande demais/);
  });
});

describe("readImportFile / sheetToImportFile", () => {
  it("CSV UTF-8 com BOM e ponto e vírgula", async () => {
    const f = await readImportFile(fileOf("pacientes_dietbox.csv", "\uFEFFNome;E-mail\nJoão;j@x.com\nBia;b@x.com"));
    expect(f.headers).toEqual(["Nome", "E-mail"]);
    expect(f.rows).toEqual([
      { line: 2, cells: ["João", "j@x.com"] },
      { line: 3, cells: ["Bia", "b@x.com"] },
    ]);
  });
  it("CSV em Windows-1252 (acentos de exportação antiga) é decodificado", async () => {
    const latin1 = Uint8Array.from([..."Nome;Objetivo\nJos".split("").map((c) => c.charCodeAt(0)), 0xe9, ..."; Emagrecimento".split("").map((c) => c.charCodeAt(0))]);
    const f = await readImportFile(fileOf("a.csv", latin1));
    expect(f.rows[0].cells[0]).toBe("José");
  });
  it("XLSX pelo nome do arquivo e xlsx renomeado para .csv", async () => {
    const x = excelStyleXlsx();
    expect((await readImportFile(fileOf("a.xlsx", x))).rows[0].cells[0]).toBe("Ana Souza");
    expect((await readImportFile(fileOf("a.csv", x))).rows[0].cells[0]).toBe("Ana Souza");
  });
  it("recusas em português: .xls, outro formato, vazio, só cabeçalho", async () => {
    await expect(readImportFile(fileOf("a.xls", "x"))).rejects.toThrowError(/\.xlsx ou \.csv/);
    await expect(readImportFile(fileOf("a.pdf", "x"))).rejects.toThrowError(/\.csv ou \.xlsx/);
    await expect(readImportFile(fileOf("a.csv", ""))).rejects.toThrowError(/vazio/);
    await expect(readImportFile(fileOf("a.csv", "Nome;Email"))).rejects.toThrowError(/só tem o cabeçalho/);
  });
  it("limite de bytes no valor exato", async () => {
    const mk = (size: number) => ({ name: "a.csv", size, arrayBuffer: async () => strToU8("Nome\nAna").buffer as ArrayBuffer });
    await expect(readImportFile(mk(IMPORT_MAX_FILE_BYTES + 1))).rejects.toThrowError(/5 MB/);
    await expect(readImportFile(mk(IMPORT_MAX_FILE_BYTES))).resolves.toBeTruthy();
  });
  it("limite de linhas e de colunas nos valores exatos", () => {
    const rowsOf = (n: number) => [["Nome"], ...Array.from({ length: n }, (_, i) => [`P${i}`])];
    expect(sheetToImportFile("a.csv", rowsOf(IMPORT_MAX_ROWS)).rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(() => sheetToImportFile("a.csv", rowsOf(IMPORT_MAX_ROWS + 1))).toThrowError(/limite é 500/);
    const colsOf = (n: number) => [Array.from({ length: n }, (_, i) => `C${i}`), Array.from({ length: n }, () => "x")];
    expect(() => sheetToImportFile("a.csv", colsOf(IMPORT_MAX_COLS))).not.toThrow();
    expect(() => sheetToImportFile("a.csv", colsOf(IMPORT_MAX_COLS + 1))).toThrowError(/colunas/);
  });
});
