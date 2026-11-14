import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_LABEL, MAX_CLOSING_FILE_BYTES, acceptanceText, brDate, brDateTime, canSelectForApproval, closingErrorMessage, closingFileError, closingFilePath, closingTableColumns, formatTaxId, paymentFileColumns,
  paymentText, periodLabel, previousPeriod, statementColumns, statementItems, withholdingColumns, withholdingRows, type ClosingRow, type PaymentFileRow,
} from "./finClosing";
import { toCsv } from "./tableExport";

const row = (over: Partial<ClosingRow> = {}): ClosingRow => ({
  id: "cp1", professional_id: "p1", name: "Dra. A", bond_type: "pj", appointments: 2, pct_cents: 660000, fixed_exec_cents: 0, fixed_monthly_cents: 100000, guarantee_cents: 0, commission_cents: 0, usage_fee_cents: 0, adjustment_cents: 5000,
  gross_cents: 765000, withholding_cents: 47048, net_cents: 717952,
  withholdings: [{ rule_type: "irrf", label: null, rate_pct: 1.5, amount_cents: 11475, waived: null }, { rule_type: "pis_cofins_csll", label: null, rate_pct: 4.65, amount_cents: 35573, waived: null }],
  negative: false, status: "open", acceptance: "pending", accept_deadline: "2026-11-18", deadline_passed: false, notified_at: null, stmt_version: 1, requires_invoice: true, nf_status: "pending",
  invoice_number: null, invoice_date: null, invoice_path: null, paid_on: null, pay_method: null, pay_note: null, proof_path: null, payment_status: "pending", open_disputes: 0, answered_disputes: 0, ...over,
});

describe("datas do fechamento (Brasília)", () => {
  it("o mês anterior a hoje; janeiro volta para dezembro do ano anterior", () => {
    expect(previousPeriod("2026-11-13")).toBe("2026-10");
    expect(previousPeriod("2027-01-02")).toBe("2026-12");
  });
  it("competência por extenso e datas em dd/mm/aaaa", () => {
    expect(periodLabel("2026-06")).toBe("junho de 2026");
    expect(brDate("2026-07-05")).toBe("05/07/2026");
    expect(brDate(null)).toBe("—");
  });
  it("data-hora é mostrada no horário de Brasília (23h30 de 30/06 em Brasília NÃO vira 1º/07)", () => {
    expect(brDateTime("2026-07-01T02:30:00Z")).toContain("30/06/2026");
    expect(brDateTime("2026-07-01T02:30:00Z")).toContain("23:30");
  });
});

describe("aceite, pagamento e seleção para aprovar", () => {
  it("aceite mostra o prazo; vencido avisa; os demais usam o rótulo do documento", () => {
    expect(acceptanceText(row())).toBe("Pendente · até 18/11/2026");
    expect(acceptanceText(row({ deadline_passed: true }))).toBe("Pendente · prazo venceu em 18/11/2026");
    expect(acceptanceText(row({ acceptance: "approved_without", status: "approved" }))).toBe("Aprovado sem aceite");
    expect(ACCEPTANCE_LABEL.contested).toBe("Contestado");
  });
  it("só entra na aprovação em lote o extrato aceito ou com prazo vencido (F8); contestado e já aprovado não", () => {
    expect(canSelectForApproval(row({ acceptance: "accepted" }))).toBe(true);
    expect(canSelectForApproval(row({ acceptance: "pending", deadline_passed: true }))).toBe(true);
    expect(canSelectForApproval(row({ acceptance: "pending" }))).toBe(false);
    expect(canSelectForApproval(row({ acceptance: "contested", deadline_passed: true }))).toBe(false);
    expect(canSelectForApproval(row({ acceptance: "accepted", status: "approved" }))).toBe(false);
  });
  it("texto do pagamento: aguardando aprovação, nada a pagar, pendente e pago em dd/mm", () => {
    expect(paymentText(row())).toBe("Aguardando aprovação");
    expect(paymentText(row({ status: "approved", net_cents: 0, payment_status: "none" }))).toBe("Nada a pagar");
    expect(paymentText(row({ status: "approved" }))).toBe("Pendente");
    expect(paymentText(row({ status: "paid", payment_status: "paid", paid_on: "2026-07-05" }))).toBe("Pago em 05/07/2026");
  });
});

describe("mensagens de erro do servidor", () => {
  it("traduz os códigos do fechamento", () => {
    expect(closingErrorMessage({ message: "PERIOD_LOCKED: mês travado" })).toMatch(/travado/);
    expect(closingErrorMessage({ message: "UNRULED_PENDING: 1 participante" })).toMatch(/sem regra/);
    expect(closingErrorMessage({ message: "INVOICE_REQUIRED: a NF" })).toMatch(/NF/);
    expect(closingErrorMessage({ message: "PERIOD_NOT_ENDED" })).toMatch(/dia 1 do mês seguinte/);
    expect(closingErrorMessage({ code: "42501", message: "forbidden" })).toBe("Você não tem permissão para esta ação.");
    expect(closingErrorMessage({ message: "boom" })).toMatch(/Tente novamente/);
  });
});

describe("arquivos da NF e do comprovante", () => {
  it("caminho <clínica>/<extrato>/<arquivo> com nome limpo (sem acento, espaço ou barra)", () => {
    const p = closingFilePath("c1", "cp1", "nf", "Nota Fiscal nº 12/2026 ção.pdf", 1700000000000);
    expect(p).toBe("c1/cp1/nf-1700000000000-Nota-Fiscal-n-12-2026-cao.pdf");
    expect(p.split("/")).toHaveLength(3);
  });
  it("nome vazio vira «arquivo»", () => {
    expect(closingFilePath("c", "e", "comprovante", "***", 1)).toBe("c/e/comprovante-1-arquivo");
  });
  it("aceita PDF e imagem até 10 MB; recusa o resto", () => {
    expect(closingFileError({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(closingFileError({ type: "image/png", size: 1000 })).toBeNull();
    expect(closingFileError({ type: "text/html", size: 1000 })).toMatch(/PDF ou uma imagem/);
    expect(closingFileError({ type: "application/pdf", size: MAX_CLOSING_FILE_BYTES + 1 })).toMatch(/10 MB/);
    expect(closingFileError({ type: "application/pdf", size: 0 })).toMatch(/vazio/);
  });
});

describe("exportações (F14, tabela do gestor, retenções, extrato)", () => {
  it("arquivo de pagamento: nome, CPF/CNPJ formatado, chave Pix/banco e líquido em reais", () => {
    const rows: PaymentFileRow[] = [{ closing_pro_id: "a", name: "Dra. A", tax_id: "52998224725", pix_key: "a@pix.test", bank_name: null, bank_agency: null, bank_account: null, net_cents: 717952 },
      { closing_pro_id: "b", name: "Clínica B", tax_id: "11222333000181", pix_key: null, bank_name: "Banco X", bank_agency: "0001", bank_account: "123-4", net_cents: 110000 }];
    const csv = toCsv(paymentFileColumns, rows);
    expect(csv.split("\r\n")[0]).toBe("\uFEFFNome;CPF/CNPJ;Chave Pix;Banco;Agência;Conta;Valor líquido (R$)");
    expect(csv).toContain("Dra. A;529.982.247-25;a@pix.test;;;;7179,52");
    expect(csv).toContain("Clínica B;11.222.333/0001-81;;Banco X;0001;123-4;1100,00");
    expect(formatTaxId(null)).toBe("");
  });
  it("tabela do gestor: uma linha por profissional, retenção negativa e líquido = bruto − retenções", () => {
    const r = row();
    const csv = toCsv(closingTableColumns("2026-06"), [r]);
    const line = csv.split("\r\n")[1].split(";");
    const head = csv.split("\r\n")[0].replace("\uFEFF", "").split(";");
    const at = (h: string) => line[head.indexOf(h)];
    expect(at("Competência")).toBe("junho de 2026");
    expect(at("Total bruto (R$)")).toBe("7650,00");
    expect(at("Retenções (R$)")).toBe("-470,48");
    expect(at("Líquido a pagar (R$)")).toBe("7179,52");
    expect(Number(at("Total bruto (R$)").replace(",", ".")) + Number(at("Retenções (R$)").replace(",", "."))).toBeCloseTo(Number(at("Líquido a pagar (R$)").replace(",", ".")), 2);
    expect(at("Aceite")).toBe("Pendente");
  });
  it("retenções por tipo e profissional, com a dispensa do Simples", () => {
    const rows = withholdingRows([row(), row({ id: "cp2", name: "Enf. B", gross_cents: 1000000, withholdings: [{ rule_type: "irrf", label: null, rate_pct: 1.5, amount_cents: 0, waived: "simples" }] })]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ name: "Dra. A", tax: "IRRF", rate: "1,5%", amount: 11475 });
    expect(rows[2]).toMatchObject({ name: "Enf. B", waived: "Dispensada (Simples)" });
    const csv = toCsv(withholdingColumns("2026-06"), rows);
    expect(csv).toContain("junho de 2026;Dra. A;IRRF;1,5%;7650,00;114,75;");
  });
  it("extrato: lançamentos, linhas mensais e retenções somam o líquido", () => {
    const items = statementItems(
      [{ source_date: "2026-06-05", patient: "P. U.", service_name: "Consulta", role: "responsavel", kind: "original", line_type: "pct", gross_cents: 1000000, base_cents: 1000000, pct: 60, amount_cents: 600000 },
        { source_date: "2026-07-02", patient: "P. U.", service_name: "Consulta", role: "responsavel", kind: "correction", line_type: "adjustment", gross_cents: -100000, base_cents: -100000, pct: 60, amount_cents: -60000 }],
      [{ line_type: "fixed_monthly", amount_cents: 100000 }, { line_type: "adjustment", amount_cents: -50000, memory: { carried_negative: true } }],
      [{ rule_type: "irrf", label: null, rate_pct: 1.5, amount_cents: 7500, waived: null }, { rule_type: "iss", label: null, rate_pct: 2, amount_cents: 0, waived: "simples" }],
      () => "Responsável",
    );
    expect(items.map((i) => i.type)).toEqual(["Percentual", "Estorno / ajuste", "Fixo mensal", "Saldo trazido", "Retenção"]);
    expect(items.reduce((a, i) => a + i.amount, 0)).toBe(600000 - 60000 + 100000 - 50000 - 7500);
    expect(toCsv(statementColumns, items)).toContain("05/06/2026;P. U.;Consulta · Responsável;Percentual;10000,00;10000,00;60;6000,00");
  });
});

describe("achados D38", () => {
  it("retenção zero não vira -0,00 e aviso mostra data de Brasília", async () => {
    const m = await import("@/lib/domain/finClosing");
    expect(Object.is(m.negCents(0), -0)).toBe(false);
    expect(m.negCents(1500)).toBe(-1500);
    expect(m.notifiedText(null)).toBe("Ainda não enviado ao profissional");
    expect(m.notifiedText("2026-11-14T01:30:00Z")).toBe("Enviado ao profissional em 13/11/2026, 22:30");
  });
});

describe("histórico do fechamento (D39)", () => {
  it("mostra só o mês e explica a destrava com o motivo", async () => {
    const { closingHistoryRows } = await import("@/lib/domain/finClosing");
    const rows = closingHistoryRows([
      { id: "1", entity: "closing", entity_id: "c1", action: "update", after: { period: "2026-10", status: "conferencia", ledger_reversed: 0 }, reason: "reabrir para conferir", user_name: "Ana", at: "2026-11-14T02:34:02Z" },
      { id: "2", entity: "closing_pro", entity_id: "x", action: "update", after: { period: "2026-10" }, reason: "Extrato aprovado", user_name: null, at: "2026-11-14T02:30:00Z" },
      { id: "3", entity: "closing", entity_id: "c2", action: "create", after: { period: "2026-09" }, reason: "Fechamento de 2026-09 iniciado", user_name: null, at: "2026-11-14T02:36:00Z" },
      { id: "4", entity: "sale", entity_id: "c1", action: "create", after: { period: "2026-10" }, reason: "Venda", user_name: null, at: "2026-11-14T02:36:00Z" },
    ], "c1", "2026-10");
    expect(rows.map((r) => r.text)).toEqual(["Mês destravado. Motivo: reabrir para conferir", "Extrato aprovado"]);
    expect(rows[0].when).toBe("13/11/2026, 23:34");
  });
});
