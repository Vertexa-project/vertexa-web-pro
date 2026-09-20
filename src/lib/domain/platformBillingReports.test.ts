import { describe, expect, it } from "vitest";

import { buildBillingReportCsv, currentSaoPauloMonth, validateReportPeriod } from "./platformBillingReports";

describe("platformBillingReports period", () => {
  it("defaults to the America/Sao_Paulo civil month", () => {
    const period = currentSaoPauloMonth(new Date("2026-09-20T22:00:00Z"));
    expect(period.start).toBe("2026-09-01");
    expect(period.end).toBe("2026-09-30");
  });

  it("rejects inverted or oversized ranges", () => {
    expect(validateReportPeriod("2026-09-30", "2026-09-01")).toMatch(/inicial/);
    expect(validateReportPeriod("2025-01-01", "2026-12-31")).toMatch(/366/);
    expect(validateReportPeriod("2026-09-01", "2026-09-30")).toBeNull();
  });

  it("builds a payments CSV with stable headers and neutralized clinic names", () => {
    const csv = buildBillingReportCsv("payments", {
      timezone: "America/Sao_Paulo",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      kind: "payments",
      limit: 200,
      offset: 0,
      maxLimit: 500,
      items: [
        {
          rowKind: "payment",
          clinicName: "=evil clinic",
          planCode: "pulse",
          planAttribution: "contract",
          amountCents: 39000,
          currency: "BRL",
          financialState: "received",
          dueDate: "2026-09-10",
          paymentDate: "2026-09-10",
          method: "PIX",
        },
      ],
    });
    expect(csv).toContain("clinica,plano,atribuicao,valor_centavos,moeda,situacao,vencimento,recebimento,metodo");
    expect(csv).toContain("'=evil clinic");
    expect(csv).toContain("39000");
    expect(csv.split("\r\n")[0]?.replace(/^\uFEFF/, "").split(",")).toHaveLength(9);
  });
});
