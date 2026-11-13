import { describe, expect, it } from "vitest";

import { AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, auditValueText, diffAudit } from "./finAudit";

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
