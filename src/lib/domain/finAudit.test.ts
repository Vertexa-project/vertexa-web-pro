import { describe, expect, it } from "vitest";

import { AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, auditReasonText, auditValueText, diffAudit } from "./finAudit";

describe("histórico: antes → depois", () => {
  it("mostra só o que mudou, com rótulo e dinheiro formatado", () => {
    const d = diffAudit(
      { id: "1", name: "Consulta", default_price_cents: 50000, is_active: true, updated_at: "a" },
      { id: "1", name: "Consulta", default_price_cents: 55000, is_active: false, updated_at: "b" },
    );
    expect(d.map((c) => [c.label, c.before, c.after])).toEqual([
      ["Preço padrão", expect.stringMatching(/500,00/), expect.stringMatching(/550,00/)],
      ["Ativo", "Sim", "Não"],
    ]);
  });
  it("criação: todos os campos preenchidos aparecem como — → valor", () => {
    const d = diffAudit(null, { name: "Unidade 2", license_number: null });
    expect(d).toEqual([{ field: "name", label: "Nome", before: "—", after: "Unidade 2" }]);
  });
  it("valores", () => {
    expect(auditValueText("x", null)).toBe("—");
    expect(auditValueText("rate_pct", 6.5)).toBe("6,5");
    expect(auditValueText("roles", ["responsavel", "executor"])).toBe("Responsável\nExecutor");
    expect(auditValueText("kit", [{ item_id: "a", quantity: 2 }], { itemName: () => "QA TESTE Creme" })).toBe("QA TESTE Creme × 2");
    expect(auditValueText("item_type", "medication")).toBe("Medicação aplicada");
    expect(AUDIT_ACTION_LABEL.view_sensitive).toBe("Leu dado sensível");
  });
});

describe("papéis do serviço no histórico", () => {
  it("traduz a lista de papéis", () => {
    expect(auditValueText("roles", ["responsavel", "executor"])).toBe("Responsável\nExecutor");
  });
});

describe("histórico de movimentações de estoque (Entrega 3)", () => {
  it("a movimentação aparece em português, com o nome do item e sem ids", () => {
    const d = diffAudit(null, {
      movement_type: "loss", item_name: "Ampola X", lot_code: "L1", expiry_date: "2027-01-31", qty: -2, unit_cost_cents: 4400, total_cost_cents: -8800, balance_after: 25,
      loss_kind: "breakage", lot_id: "9f0c0c3e-0000-0000-0000-000000000000", item_id: "x",
    });
    const byLabel = Object.fromEntries(d.map((c) => [c.label, c.after]));
    expect(byLabel["Movimento"]).toBe("Perda / quebra / vencimento");
    expect(byLabel["Tipo de perda"]).toBe("Quebra / avaria");
    expect(byLabel["Item"]).toBe("Ampola X");
    expect(byLabel["Validade"]).toBe("31/01/2027");
    expect(byLabel["Quantidade"]).toBe("-2");
    expect(byLabel["Custo unitário"]).toMatch(/44,00/);
    expect(d.some((c) => c.field === "lot_id" || c.field === "item_id")).toBe(false);
  });
  it("rótulos das entidades novas", () => {
    expect(AUDIT_ENTITY_LABEL.stock_movement).toBe("Movimentação de estoque");
    expect(AUDIT_ENTITY_LABEL.stock_entry).toBe("Entrada de estoque");
    expect(AUDIT_ENTITY_LABEL.stock_item_map).toBe("De/para do fornecedor");
  });
});

describe("histórico: entidades e situações das entregas 4–9", () => {
  it("todas as entidades gravadas pelo banco têm rótulo em português", () => {
    for (const k of ["appointment", "closing", "closing_pro", "stock_inventory", "stock_transfer", "clinical_document", "share_rule", "receivable", "patient_package"]) expect(AUDIT_ENTITY_LABEL[k]).toBeTruthy();
  });
  it("situação e aceite saem traduzidos", () => {
    const d = diffAudit({ status: "open", acceptance: "pending" }, { status: "answered", acceptance: "contested" });
    expect(d.map((c) => [c.label, c.before, c.after])).toEqual([["Aceite", "Pendente", "Contestado"], ["Situação", "Aberto", "Respondida"]]);
  });
});

describe("histórico das Entregas 2 a 9 sem código cru (achado D51)", () => {
  it("rótulos e valores em português; ids, autores e caminhos escondidos", () => {
    const ch = diffAudit(null, {
      cancel_reason: "teste", canceled_by: "8bed7723-e1b3-4188-b3a4-575911fea3fa", material_cost_cents: 12637, ledger_lines: 2, blind: true, scope: "all",
      from_unit: "Unidade principal", doc_type: "receita", is_demo: true, channel: "download", event: "resend", proof_path: "x/y.pdf", canceled_at: "2026-11-14T05:43:00Z",
      materials: [{ item_id: "8bed7723-e1b3-4188-b3a4-575911fea3fa", batch: 1, short_qty: 0, cost_cents: 4464 }],
    });
    const text = ch.map((c) => `${c.label}: ${c.after}`).join("\n");
    for (const raw of ["cancel_reason", "canceled_by", "material_cost_cents", "ledger_lines", "short_qty", "cost_cents", "8bed7723", "proof_path", "receita", "resend", "download"]) expect(text).not.toContain(raw);
    expect(text).toContain("Motivo do cancelamento: teste");
    expect(text).toContain("Custo de material: R$\u00a0126,37");
    expect(text).toContain("Tipo de documento: Receita");
    expect(text).toContain("Evento: Reenvio");
    expect(text).toContain("Contagem cega: Sim");
    expect(text).toContain("Cancelado em: 14/11/2026 02:43");
  });
});

describe("histórico: datas, competência e códigos de caixa e estoque (achado D52)", () => {
  it("sem formato ISO e sem código cru", () => {
    const ch = diffAudit(null, { performed_on: "2026-11-13", business_date: "2026-11-13", period: "2026-09", movement_type: "transfer_out",
      expected_lines: [{ key: "cash", expected_cents: 1000 }] });
    const text = ch.map((c) => `${c.label}: ${c.after}`).join("\n");
    expect(text).toContain("Realizado em: 13/11/2026");
    expect(text).toContain("Data do caixa: 13/11/2026");
    expect(text).toContain("Competência: 09/2026");
    expect(text).toContain("Movimento: Transferência (saída)");
    expect(text).toContain("Chave: Dinheiro");
    for (const raw of ["2026-11-13", "2026-09", "transfer_out", ": cash"]) expect(text).not.toContain(raw);
  });
});

describe("motivo do histórico (achado D53)", () => {
  it("datas e competências do texto gravado saem em pt-BR", () => {
    expect(auditReasonText("Aprovado sem aceite (prazo vencido em 2026-11-12)")).toBe("Aprovado sem aceite (prazo vencido em 12/11/2026)");
    expect(auditReasonText("Arquivo de pagamento do fechamento 2026-10")).toBe("Arquivo de pagamento do fechamento 10/2026");
    expect(auditReasonText("Fechamento de 2026-09/2026-10 iniciado")).toBe("Fechamento de 09/2026 e 10/2026 iniciado");
    expect(auditReasonText(null)).toBe("—");
  });
});
