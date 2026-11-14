import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";

import { toCsv, toXlsx, type ExportColumn } from "./tableExport";

interface Row { name: string; price: number; qty: number; active: boolean; note?: string | null }
const cols: ExportColumn<Row>[] = [
  { header: "Nome", value: (r) => r.name },
  { header: "Preço (R$)", value: (r) => r.price, kind: "money" },
  { header: "Quantidade", value: (r) => r.qty, kind: "qty" },
  { header: "Ativo", value: (r) => r.active },
  { header: "Obs.", value: (r) => r.note },
];
const rows: Row[] = [
  { name: "Consulta; \"premium\"", price: 123450, qty: 2.5, active: true, note: null },
  { name: "Ampola <A&B>", price: 5, qty: 0.125, active: false, note: "ok" },
];

describe("exportação CSV/XLSX", () => {
  it("CSV: BOM, separador ;, dinheiro com 2 casas e vírgula, quantidade até 3 casas, aspas escapadas", () => {
    const csv = toCsv(cols, rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Nome;Preço (R$);Quantidade;Ativo;Obs.");
    expect(lines[1]).toBe('"Consulta; ""premium""";1234,50;2,5;Sim;');
    expect(lines[2]).toBe("Ampola <A&B>;0,05;0,125;Não;ok");
  });

  it("XLSX: zip válido com a planilha, texto escapado, dinheiro numérico em reais e estilos de 2/3 casas", () => {
    const files = unzipSync(toXlsx(cols, rows, "Serviços"));
    expect(Object.keys(files).sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort(),
    );
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("Ampola &lt;A&amp;B&gt;");
    expect(sheet).toContain('<c r="B2" s="2"><v>1234.5</v></c>');
    expect(sheet).toContain('<c r="B3" s="2"><v>0.05</v></c>');
    expect(sheet).toContain('<c r="C3" s="3"><v>0.125</v></c>');
    expect(strFromU8(files["xl/workbook.xml"])).toContain('name="Serviços"');
    expect(strFromU8(files["xl/styles.xml"])).toContain('formatCode="#,##0.00"');
  });
});

describe("custo unitário (D27a)", () => {
  it("CSV com 4 casas fixas e sem ruído de ponto flutuante", () => {
    const c: ExportColumn<{ v: number }>[] = [{ header: "Custo", value: (r) => r.v, kind: "unitcost" }];
    const lines = toCsv(c, [{ v: 446430.1 / 10000 }, { v: 44.643010000000004 }, { v: 12 }]).slice(1).trimEnd().split("\r\n");
    expect(lines.slice(1)).toEqual(["44,6430", "44,6430", "12,0000"]);
    expect(toXlsx(c, [{ v: 1 }], "x").length).toBeGreaterThan(0);
  });
});
