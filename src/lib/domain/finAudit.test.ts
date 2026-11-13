import { describe, expect, it } from "vitest";

import { AUDIT_ACTION_LABEL, auditValueText, diffAudit } from "./finAudit";

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
    expect(auditValueText("roles", ["responsavel", "executor"])).toBe("responsavel, executor");
    expect(auditValueText("kit", [{ item_id: "a", quantity: 2 }])).toBe('[{"item_id":"a","quantity":2}]');
    expect(AUDIT_ACTION_LABEL.view_sensitive).toBe("Leu dado sensível");
  });
});
