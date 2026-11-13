import { describe, expect, it } from "vitest";

import { buildEntryLines, matchNfeItems, NfeError, parseNfeXml, suggestFactor, validateNfeLines, type CatalogItem, type NfeLineDraft } from "./nfe";

// NF-e FICTÍCIA (empresa, CNPJ de teste, chave e produtos inventados) — só para provar a leitura.
const KEY = "35261111222333000181550010000012341000012349";
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${KEY}" versao="4.00">
      <ide><cUF>35</cUF><serie>1</serie><nNF>1234</nNF><dhEmi>2026-11-10T09:30:00-03:00</dhEmi></ide>
      <emit><CNPJ>11222333000181</CNPJ><xNome>Distribuidora Exemplo Ltda</xNome></emit>
      <det nItem="1"><prod>
        <cProd>AMP-001</cProd><cEAN>7891234567895</cEAN><xProd>Vitamina C 500 mg ampola</xProd><uCom>CX</uCom>
        <qCom>2.0000</qCom><vUnCom>230.0000000000</vUnCom><vProd>460.00</vProd><vDesc>10.00</vDesc>
        <rastro><nLote>LOTE-A1</nLote><qLote>2.000</qLote><dFab>2026-09-01</dFab><dVal>2027-09-01</dVal></rastro>
      </prod></det>
      <det nItem="2"><prod>
        <cProd>SER-5ML</cProd><cEAN>SEM GTIN</cEAN><xProd>Seringa 5 ml</xProd><uCom>UN</uCom>
        <qCom>100.0000</qCom><vUnCom>1.2000000000</vUnCom><vProd>120.00</vProd>
      </prod></det>
      <det nItem="3"><prod>
        <cProd>FRA-30</cProd><cEAN>7890000000017</cEAN><xProd>Frasco multidose 30 ml</xProd><uCom>FR</uCom>
        <qCom>3.0000</qCom><vUnCom>45.5000000000</vUnCom><vProd>136.50</vProd>
      </prod></det>
      <total><ICMSTot><vProd>716.50</vProd><vFrete>20.00</vFrete><vNF>726.50</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><chNFe>${KEY}</chNFe></infProt></protNFe>
</nfeProc>`;

const catalog: CatalogItem[] = [
  { id: "i-vitc", name: "Vitamina C 500 mg ampola", ean: null, purchaseUnit: "cx", purchaseToStockFactor: 10, isActive: true },
  { id: "i-ser", name: "Seringa 5 ml descartável", ean: null, purchaseUnit: "cx", purchaseToStockFactor: 100, isActive: true },
  { id: "i-fra", name: "Frasco multidose", ean: "7890000000017", purchaseUnit: "frasco", purchaseToStockFactor: 1, isActive: true },
  { id: "i-velho", name: "Frasco antigo", ean: "7890000000017", purchaseUnit: "frasco", purchaseToStockFactor: 1, isActive: false },
];

describe("leitura do XML da NF-e", () => {
  const nfe = parseNfeXml(XML);

  it("cabeçalho: chave de 44 dígitos, número, série, emissão e fornecedor por CNPJ", () => {
    expect(nfe.key).toBe(KEY);
    expect(nfe.number).toBe("1234");
    expect(nfe.series).toBe("1");
    expect(nfe.issueDate).toBe("2026-11-10");
    expect(nfe.supplier).toEqual({ taxId: "11222333000181", name: "Distribuidora Exemplo Ltda" });
    expect(nfe.freightCents).toBe(2000);
  });

  it("itens: código do fornecedor, EAN válido (SEM GTIN vira nulo), quantidade e total já descontado, lote e validade (rastro)", () => {
    expect(nfe.items).toHaveLength(3);
    expect(nfe.items[0]).toMatchObject({ n: 1, code: "AMP-001", ean: "7891234567895", unit: "CX", qty: 2, totalCents: 45000, lots: [{ code: "LOTE-A1", expiry: "2027-09-01", qty: 2 }] });
    expect(nfe.items[1]).toMatchObject({ code: "SER-5ML", ean: null, qty: 100, totalCents: 12000, lots: [] });
    expect(nfe.items[2]).toMatchObject({ code: "FRA-30", qty: 3, totalCents: 13650 });
  });

  it("aceita NFe sem o envelope nfeProc (sem namespace) e usa a chave do protocolo quando faltar o Id", () => {
    const bare = `<NFe><infNFe><ide><nNF>9</nNF></ide><emit><CNPJ>11222333000181</CNPJ><xNome>X</xNome></emit>
      <det nItem="1"><prod><cProd>A</cProd><xProd>Item</xProd><uCom>UN</uCom><qCom>1</qCom><vProd>5.00</vProd></prod></det></infNFe></NFe>`;
    expect(() => parseNfeXml(bare)).toThrow(NfeError); // sem chave
    const withProt = `<r>${bare}<protNFe><infProt><chNFe>${KEY}</chNFe></infProt></protNFe></r>`;
    expect(parseNfeXml(withProt).key).toBe(KEY);
  });

  it("recusa arquivo vazio, não-XML, XML que não é NF-e, sem itens e grande demais — com mensagem pronta", () => {
    const code = (s: string) => { try { parseNfeXml(s); return null; } catch (e) { return (e as NfeError).code; } };
    expect(code("")).toBe("NFE_EMPTY");
    expect(code("isto não é xml <<<")).toBe("NFE_NOT_XML");
    expect(code("<html><body>oi</body></html>")).toBe("NFE_NOT_NFE");
    expect(code(`<NFe><infNFe Id="NFe${KEY}"><ide><nNF>1</nNF></ide></infNFe></NFe>`)).toBe("NFE_NO_ITEMS");
    expect(code(`<a>${"x".repeat(2 * 1024 * 1024 + 1)}</a>`)).toBe("NFE_TOO_BIG");
  });
});

describe("de/para dos itens do fornecedor (E14)", () => {
  const nfe = parseNfeXml(XML);

  it("E14: item novo do fornecedor pede vínculo; EAN e nome igual sugerem sozinhos", () => {
    const m = matchNfeItems(nfe.items, catalog, []);
    expect(m[0]).toMatchObject({ itemId: "i-vitc", source: "name", factor: 10 }); // nome igual; unidade CX = unidade de compra → fator do cadastro
    expect(m[1]).toMatchObject({ itemId: null, source: "none", factor: 1 });
    expect(m[2]).toMatchObject({ itemId: "i-fra", source: "ean" }); // o EAN aponta o item ativo, não o inativo
  });

  it("na próxima nota o mesmo código é vinculado sozinho, com o fator salvo", () => {
    const maps = [{ supplierCode: "SER-5ML", itemId: "i-ser", conversionFactor: 100 }, { supplierCode: "AMP-001", itemId: "i-vitc", conversionFactor: 10 }];
    const m = matchNfeItems(nfe.items, catalog, maps);
    expect(m[1]).toMatchObject({ itemId: "i-ser", source: "map", factor: 100 });
    expect(m[0]).toMatchObject({ itemId: "i-vitc", source: "map", factor: 10 });
  });

  it("de/para para item desativado é ignorado (volta a pedir vínculo ou sugere por EAN)", () => {
    const m = matchNfeItems(nfe.items, catalog, [{ supplierCode: "FRA-30", itemId: "i-velho", conversionFactor: 1 }]);
    expect(m[2]).toMatchObject({ itemId: "i-fra", source: "ean" });
  });

  it("fator sugerido: o do de/para; senão o do cadastro quando a unidade da nota é a de compra; senão 1", () => {
    expect(suggestFactor("CX", catalog[1], undefined)).toBe(100);                // «cx» = «CX»
    expect(suggestFactor("Cx.", catalog[0], undefined)).toBe(10);
    expect(suggestFactor("UN", catalog[1], undefined)).toBe(1);
    expect(suggestFactor("UN", catalog[1], { supplierCode: "x", itemId: "i-ser", conversionFactor: 25 })).toBe(25);
  });
});

describe("linhas da entrada a partir da nota", () => {
  const nfe = parseNfeXml(XML);
  const drafts: NfeLineDraft[] = [
    { itemId: "i-vitc", factor: 10, lotCode: "LOTE-A1", expiry: "2027-09-01" },   // 2 caixas × 10 = 20 ampolas
    { itemId: "i-ser", factor: 100, lotCode: "", expiry: "" },                       // 100 UN × 100? (fator mal escolhido de propósito)
    { itemId: null, factor: 1, lotCode: "", expiry: "", skip: true },               // frasco: não entra
  ];

  it("quantidade da nota × fator = unidades de estoque; o total da linha é o da nota (vProd − vDesc)", () => {
    const lines = buildEntryLines(nfe.items, drafts);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ itemId: "i-vitc", quantity: 20, lineTotalCents: 45000, lotCode: "LOTE-A1", expiryDate: "2027-09-01", supplierCode: "AMP-001", conversionFactor: 10 });
    expect(lines[1]).toMatchObject({ itemId: "i-ser", quantity: 10000, lineTotalCents: 12000, lotCode: null, expiryDate: null, supplierCode: "SER-5ML" });
  });

  it("valida antes de confirmar: item escolhido, lote e validade quando o item exige, unidades inteiras", () => {
    const meta = new Map([
      ["i-vitc", { lotControl: true, fractional: false, name: "Vitamina C" }],
      ["i-ser", { lotControl: false, fractional: false, name: "Seringa" }],
    ]);
    expect(validateNfeLines(nfe.items, drafts, meta, "2026-11-13")).toEqual({});
    const bad: NfeLineDraft[] = [{ itemId: "i-vitc", factor: 10, lotCode: "", expiry: "" }, { itemId: null, factor: 1, lotCode: "", expiry: "" }, { itemId: "i-fra", factor: 0.5, lotCode: "", expiry: "" }];
    const errs = validateNfeLines(nfe.items, bad, new Map([...meta, ["i-fra", { lotControl: false, fractional: false, name: "Frasco" }]]), "2026-11-13");
    expect(errs[0]).toMatch(/lote e a validade/);
    expect(errs[1]).toMatch(/Escolha o item/);
    expect(errs[2]).toMatch(/unidades inteiras/);
    expect(validateNfeLines(nfe.items, [{ ...drafts[0], expiry: "2026-01-01" }, drafts[1], drafts[2]], meta, "2026-11-13")[0]).toMatch(/já passou/);
  });
});
