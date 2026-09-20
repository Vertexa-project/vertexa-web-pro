import { describe, expect, it } from "vitest";

import {
  billingCsvFilename,
  buildCsv,
  escapeCsvCell,
  neutralizeSpreadsheetFormula,
} from "./billingCsv";

describe("billingCsv", () => {
  it("escapes commas, quotes and line breaks", () => {
    const csv = buildCsv(
      ["clinica", "nota"],
      [
        ["Clínica Norte, filial", 'disse "pago"'],
        ["Linha\r\nquebrada", "ok"],
      ],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Clínica Norte, filial"');
    expect(csv).toContain('"disse ""pago"""');
    expect(csv).toContain('"Linha\r\nquebrada"');
    expect(csv.split("\r\n").length).toBeGreaterThan(3);
  });

  it("keeps UTF-8 accents and empty or zero cells", () => {
    const csv = buildCsv(["clinica", "valor"], [["Clínica Açaí", 0], ["", ""]]);
    expect(csv).toContain("Clínica Açaí");
    expect(csv).toContain(",0");
    expect(csv).toContain(",\r\n");
  });

  it("neutralizes spreadsheet formula prefixes without changing monetary digits", () => {
    expect(neutralizeSpreadsheetFormula("=CMD()")).toBe("'=CMD()");
    expect(neutralizeSpreadsheetFormula("+HYPERLINK()")).toBe("'+HYPERLINK()");
    expect(neutralizeSpreadsheetFormula("-1+1")).toBe("'-1+1");
    expect(neutralizeSpreadsheetFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell(39000, { numeric: true })).toBe("39000");
    expect(escapeCsvCell(0, { numeric: true })).toBe("0");
  });

  it("neutralizes malicious clinic and event text in the built CSV", () => {
    const csv = buildCsv(
      ["clinica", "motivo"],
      [
        ["=1+1", "@event"],
        ["+cmd", "-reason"],
      ],
    );
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@event");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-reason");
    expect(csv).not.toMatch(/(^|,)=1\+1/m);
  });

  it("uses a safe deterministic filename", () => {
    expect(billingCsvFilename("payments", "2026-09-01", "2026-09-30")).toBe(
      "vertexa-faturamento-payments-20260901-20260930.csv",
    );
    expect(billingCsvFilename("../etc/passwd", "2026-01-01", "2026-01-02")).toBe(
      "vertexa-faturamento-etcpasswd-20260101-20260102.csv",
    );
  });

  it("keeps stable headers and column counts", () => {
    const csv = buildCsv(["a", "b", "c"], [["1", "2", "3"], ["4", "5", "6"]]);
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe("a,b,c");
    expect(lines.every((line) => line.split(",").length === 3)).toBe(true);
  });

  it("never embeds secrets, QR or provider payloads", () => {
    const csv = buildCsv(["clinica"], [["Clínica Norte"]]);
    expect(csv).not.toMatch(/service_role|encodedImage|qr_payload|webhook|eyJ|asaas/i);
  });
});
