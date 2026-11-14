// Exemplos A a H do escopo-v1 §5.7 (+ retenções §5.8 e casos F1/F2/F3/F5/F6/F11/F15/F16 do §12.1) como testes automáticos, com os valores
// exatos em centavos. A mesma matemática roda no servidor (supabase/tests/fin_e5_repasse.test.sql prova os mesmos números em Postgres).
import { describe, expect, it } from "vitest";

import {
  clinicMargin, describeMemory, formulaInReais, fixedMonthlyAmount, guaranteeSeries, matchRules, materialShare, monthGross, packageFee, packageSessionValues, payoutBase, pctAmount, pctSum, pctSumWarning,
  releasePackageUnits, releasePeriod, resolveDeductions, simulateAppointment, taxOf, tierAdjust, tierPct, tierProgressive, usageFeeAmount, validateTiers, withholdings,
  type Deductions, type PayoutRule, type Tier,
} from "./finPayout";

const CLINIC_FEE_ONLY: Deductions = { fee: true, tax: false, material: false };
const rule = (over: Partial<PayoutRule>): PayoutRule => ({
  id: "r", professional_id: "p", role: "responsavel", target_type: "default", service_id: null, category: null, stock_item_id: null, rule_type: "pct", pct: 50, amount_cents: null, tiers: null,
  tier_scope: null, compensation: false, usage_fee_mode: null, deductions_override: null, all_units: true, unit_ids: [], valid_from: "2026-01-01", valid_to: null, is_active: true, ...over,
});
const Q = { serviceId: "s1", category: "consulta" as const, on: "2026-10-10", unitId: "u1" };

describe("Exemplo A — consulta avulsa no cartão (taxa e imposto, 60%)", () => {
  const ded = resolveDeductions(CLINIC_FEE_ONLY, { tax: true });
  const tax = taxOf(50000, 6);
  const base = payoutBase({ grossCents: 50000, feeCents: 1500, taxCents: tax, materialCents: 0 }, ded);
  it("base = 500 − 15 − 30 = 455,00", () => { expect(tax).toBe(3000); expect(base).toBe(45500); });
  it("repasse = 455 × 60% = R$ 273,00", () => expect(pctAmount(base, 60)).toBe(27300));
  it("entra no extrato de novembro (liquida em 09/11; atendimento em 10/10)", () => expect(releasePeriod("2026-11-09", "2026-10-10")).toBe("2026-11"));
  it("se o atendimento vier depois do dinheiro, vale o mês da execução", () => expect(releasePeriod("2026-09-30", "2026-10-02")).toBe("2026-10"));
  it("o simulador chega ao mesmo número pela regra cadastrada", () => {
    const lines = simulateAppointment([rule({ id: "A", professional_id: "dra-a", pct: 60, deductions_override: { tax: true } })], CLINIC_FEE_ONLY, Q,
      [{ professionalId: "dra-a", role: "responsavel" }], { grossCents: 50000, feeCents: 1500, taxPct: 6, materialCents: 0 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lineType: "pct", baseCents: 45500, pct: 60, amountCents: 27300 });
  });
});

describe("Exemplo B — aplicação com dois participantes e material", () => {
  const ded = resolveDeductions(CLINIC_FEE_ONLY, { tax: true, material: true });
  const tax = taxOf(120000, 6);
  const base = payoutBase({ grossCents: 120000, feeCents: 0, taxCents: tax, materialCents: 42000 }, ded);
  it("base = 1.200 − 0 − 72 − 420 = 708,00", () => { expect(tax).toBe(7200); expect(base).toBe(70800); });
  it("médico 708 × 30% = 212,40; enfermeira fixo R$ 30,00", () => { expect(pctAmount(base, 30)).toBe(21240); });
  it("margem da clínica 1.200 − 72 − 420 − 212,40 − 30 = 465,60", () => expect(clinicMargin(120000, 0, tax, 42000, [21240, 3000])).toBe(46560));
  it("o simulador gera as duas linhas (percentual do médico e fixo da enfermeira)", () => {
    const rules = [rule({ id: "med", professional_id: "med", pct: 30, deductions_override: { tax: true, material: true } }),
      rule({ id: "enf", professional_id: "enf", role: "executor", rule_type: "fixed_per_exec", pct: null, amount_cents: 3000 })];
    const lines = simulateAppointment(rules, CLINIC_FEE_ONLY, Q, [{ professionalId: "med", role: "responsavel" }, { professionalId: "enf", role: "executor" }],
      { grossCents: 120000, feeCents: 0, taxPct: 6, materialCents: 42000 });
    expect(lines.map((l) => [l.professionalId, l.lineType, l.amountCents])).toEqual([["med", "pct", 21240], ["enf", "fixed_exec", 3000]]);
  });
  it("material em pagamento parcelado é deduzido proporcionalmente a cada parcela", () => {
    expect(materialShare(42000, 120000, 30000)).toBe(10500);
    expect([30000, 30000, 30000, 30000].map((g) => materialShare(42000, 120000, g)).reduce((a, v) => a + v, 0)).toBe(42000);
  });
});

describe("Exemplo C — procedimento parcelado 4× (taxa 5%, só taxa, 50%)", () => {
  it("cada parcela: 500 − 25 = 475 de base → R$ 237,50 por mês", () => {
    const base = payoutBase({ grossCents: 50000, feeCents: 2500, taxCents: 0, materialCents: 0 }, CLINIC_FEE_ONLY);
    expect(base).toBe(47500);
    expect(pctAmount(base, 50)).toBe(23750);
  });
  it("nos extratos de novembro, dezembro, janeiro e fevereiro", () => {
    const months = ["2026-11-04", "2026-12-04", "2027-01-03", "2027-02-02"].map((d) => releasePeriod(d, "2026-10-05"));
    expect(months).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("Exemplo D — pacote multiprofissional (R$ 3.600 em 4× R$ 900, taxa 4%, só taxa)", () => {
  const values = packageSessionValues(360000, [{ refCents: 50000, qty: 3 }, { refCents: 30000, qty: 5 }, { refCents: 10000, qty: 10 }]);
  const [med, nutri, pers] = values;
  const feeRatioFee = (v: number) => packageFee(v, 14400, 360000);
  const sessionBase = (v: number) => payoutBase({ grossCents: v, feeCents: feeRatioFee(v), taxCents: 0, materialCents: 0 }, CLINIC_FEE_ONLY);

  it("rateio (fator 0,9): consulta 450,00 · nutri 270,00 · personal 90,00", () => expect(values).toEqual([45000, 27000, 9000]));
  it("base de cada sessão (−4%): 432,00 · 259,20 · 86,40", () => expect([sessionBase(med), sessionBase(nutri), sessionBase(pers)]).toEqual([43200, 25920, 8640]));
  it("repasse por sessão: 216,00 · 129,60 · 34,56", () => expect([pctAmount(sessionBase(med), 50), pctAmount(sessionBase(nutri), 50), pctAmount(sessionBase(pers), 40)]).toEqual([21600, 12960, 3456]));

  const sessions = [
    { id: "med", valueCents: med, occurredOn: "2026-10-05" }, { id: "nutri", valueCents: nutri, occurredOn: "2026-10-06" },
    { id: "p1", valueCents: pers, occurredOn: "2026-10-07" }, { id: "p2", valueCents: pers, occurredOn: "2026-10-08" },
    { id: "p3", valueCents: pers, occurredOn: "2026-10-09" }, { id: "p4", valueCents: pers, occurredOn: "2026-10-12" },
    { id: "nutri2", valueCents: nutri, occurredOn: "2026-11-02" }, { id: "p5", valueCents: pers, occurredOn: "2026-11-03" }, { id: "p6", valueCents: pers, occurredOn: "2026-11-04" },
    { id: "p7", valueCents: pers, occurredOn: "2026-11-05" }, { id: "p8", valueCents: pers, occurredOn: "2026-11-09" },
  ];
  it("outubro (liquidado 900): cobertas médica, nutri e 2 de personal; 2 de personal aguardam", () => {
    const rel = releasePackageUnits(sessions.slice(0, 6), [{ date: "2026-10-20", grossCents: 90000 }]);
    expect(rel.filter((r) => r.releaseDate !== null).map((r) => r.id)).toEqual(["med", "nutri", "p1", "p2"]);
    expect(rel.filter((r) => r.releaseDate === null).map((r) => r.id)).toEqual(["p3", "p4"]);
    expect(pctAmount(sessionBase(med), 50)).toBe(21600);
    expect(2 * pctAmount(sessionBase(pers), 40)).toBe(6912);
  });
  it("novembro (acumulado 1.800): as 2 pendentes + as 4 do mês; consumido 1.710", () => {
    const rel = releasePackageUnits(sessions, [{ date: "2026-10-20", grossCents: 90000 }, { date: "2026-11-30", grossCents: 90000 }]);
    const nov = rel.filter((r) => r.releaseDate?.startsWith("2026-11"));
    expect(nov.map((r) => r.id)).toEqual(["p3", "p4", "nutri2", "p5", "p6", "p7", "p8"]);
    expect(rel[rel.length - 1].coveredCents).toBe(171000);
    const persNov = nov.filter((r) => r.id.startsWith("p")).length;
    expect(persNov).toBe(6);
    expect(persNov * pctAmount(sessionBase(pers), 40)).toBe(20736);
    expect(pctAmount(sessionBase(nutri), 50)).toBe(12960);
  });
  it("sessão realizada e não coberta nunca vira repasse parcial (sempre inteira)", () => {
    const rel = releasePackageUnits([{ id: "a", valueCents: 45000, occurredOn: "2026-10-01" }], [{ date: "2026-10-20", grossCents: 44999 }]);
    expect(rel[0].releaseDate).toBeNull();
  });
  it("sessão cuja cobertura já veio antes: libera na data da execução", () => {
    const rel = releasePackageUnits([{ id: "a", valueCents: 45000, occurredOn: "2026-10-25" }], [{ date: "2026-10-20", grossCents: 90000 }]);
    expect(rel[0].releaseDate).toBe("2026-10-25");
  });
});

describe("Exemplo E — troca de regime da enfermeira (novembro, 30 dias)", () => {
  it("fixo mensal 2.500 × 15/30 = R$ 1.250,00", () => expect(fixedMonthlyAmount(250000, "2026-01-01", "2026-11-15", "2026-11")).toBe(125000));
  it("22 aplicações × R$ 30 = R$ 660,00", () => expect(22 * 3000).toBe(66000));
  it("extrato de novembro da enfermeira: R$ 1.910,00", () => {
    const g = monthGross({ pct: 0, tierAdjust: 0, fixedExec: 22 * 3000, fixedMonthly: fixedMonthlyAmount(250000, "2026-01-01", "2026-11-15", "2026-11"), guarantee: 0, commission: 0, usageFee: 0, adjustments: 0, carryIn: 0 });
    expect(g).toBe(191000);
  });
  it("meses inteiros e fora da vigência", () => {
    expect(fixedMonthlyAmount(250000, "2026-01-01", "2026-11-15", "2026-10")).toBe(250000);
    expect(fixedMonthlyAmount(250000, "2026-01-01", "2026-11-15", "2026-12")).toBe(0);
    expect(fixedMonthlyAmount(300000, "2026-11-16", null, "2026-11")).toBe(150000);
  });
  it("F3: regra alterada em 16/11 — atendimentos até 15/11 usam a antiga; depois, a nova", () => {
    const rules = [rule({ id: "antiga", professional_id: "e", role: "executor", rule_type: "fixed_per_exec", pct: null, amount_cents: 0, valid_to: "2026-11-15" }),
      rule({ id: "nova", professional_id: "e", role: "executor", rule_type: "fixed_per_exec", pct: null, amount_cents: 3000, valid_from: "2026-11-16" })];
    const q = { professionalId: "e", role: "executor" as const, serviceId: "s", category: "aplicacao" as const, unitId: null };
    expect(matchRules(rules, { ...q, on: "2026-11-15" }).map((r) => r.id)).toEqual(["antiga"]);
    expect(matchRules(rules, { ...q, on: "2026-11-16" }).map((r) => r.id)).toEqual(["nova"]);
  });
});

describe("Exemplo F — garantia mínima (50%, piso R$ 8.000)", () => {
  const variables = [pctAmount(12000_00, 50), pctAmount(20000_00, 50)];
  it("sem compensação: mês 1 complemento 2.000 → recebe 8.000; mês 2 recebe 10.000", () => {
    const [m1, m2] = guaranteeSeries(800000, false, variables);
    expect([m1.complementCents, m1.receivesCents, m1.balanceCents]).toEqual([200000, 800000, 0]);
    expect([m2.complementCents, m2.abatedCents, m2.receivesCents]).toEqual([0, 0, 1000000]);
  });
  it("com compensação: mês 1 saldo a compensar 2.000; mês 2 o excedente (2.000) abate o saldo → recebe 8.000; saldo 0", () => {
    const [m1, m2] = guaranteeSeries(800000, true, variables);
    expect([m1.complementCents, m1.receivesCents, m1.balanceCents]).toEqual([200000, 800000, 200000]);
    expect([m2.abatedCents, m2.receivesCents, m2.balanceCents]).toEqual([200000, 800000, 0]);
  });
  it("o piso compara só percentual + fixo por execução (comissão não entra)", () => {
    const [m] = guaranteeSeries(800000, false, [600000 + 0]);
    expect(m.complementCents).toBe(200000);
  });
});

describe("Exemplo G — faixas por meta (50% até R$ 20.000; 60% acima)", () => {
  const tiers: Tier[] = [{ up_to_cents: 2000000, pct: 50 }, { up_to_cents: null, pct: 60 }];
  it("base do mês R$ 30.000: 20.000 × 50% + 10.000 × 60% = R$ 16.000,00", () => expect(tierProgressive(tiers, 3000000)).toBe(1600000));
  it("durante o mês a prévia usa a faixa atingida até ali", () => { expect(tierPct(tiers, 1500000)).toBe(50); expect(tierPct(tiers, 2000000)).toBe(50); expect(tierPct(tiers, 2000001)).toBe(60); });
  it("no fechamento a diferença aparece como «ajuste de faixa»", () => {
    const lines = pctAmount(1500000, 50) + pctAmount(1500000, 60);
    expect(lines).toBe(1650000);
    expect(tierAdjust(tiers, 3000000, lines)).toBe(-50000);
    expect(lines + tierAdjust(tiers, 3000000, lines)).toBe(1600000);
  });
  it("base abaixo da primeira faixa", () => expect(tierProgressive(tiers, 1000000)).toBe(500000));
  it("validação das faixas", () => {
    expect(validateTiers(tiers)).toBeNull();
    expect(validateTiers([{ up_to_cents: 100, pct: 10 }])).toMatch(/duas faixas/);
    expect(validateTiers([{ up_to_cents: 500, pct: 10 }, { up_to_cents: 400, pct: 20 }, { up_to_cents: null, pct: 30 }])).toMatch(/crescer/);
    expect(validateTiers([{ up_to_cents: 500, pct: 10 }, { up_to_cents: 900, pct: 20 }])).toMatch(/última/);
  });
});

describe("Exemplo H — taxa de uso (80%, R$ 1.500/mês; base R$ 12.000)", () => {
  it("12.000 × 80% = 9.600 − 1.500 = R$ 8.100,00 antes de retenções", () => {
    const pct = pctAmount(1200000, 80);
    const fee = usageFeeAmount("fixed", 150000, null, 1200000);
    expect(pct).toBe(960000);
    expect(fee).toBe(-150000);
    expect(monthGross({ pct, tierAdjust: 0, fixedExec: 0, fixedMonthly: 0, guarantee: 0, commission: 0, usageFee: fee, adjustments: 0, carryIn: 0 })).toBe(810000);
  });
  it("taxa de uso em % do liquidado", () => expect(usageFeeAmount("pct", null, 10, 1000000)).toBe(-100000));
});

describe("Retenções na fonte (§5.8) — F16", () => {
  const rules = [{ type: "irrf", ratePct: 1.5, minBaseCents: 0, waiveIfSimples: true }, { type: "pis_cofins_csll", ratePct: 4.65, minBaseCents: 0, waiveIfSimples: true }];
  it("total bruto R$ 10.000; IRRF 1,5% = 150; PIS/COFINS/CSLL 4,65% = 465; líquido R$ 9.385,00", () => {
    const r = withholdings(1000000, rules, false);
    expect(r.lines.map((l) => l.amountCents)).toEqual([15000, 46500]);
    expect(r.totalCents).toBe(61500);
    expect(r.netCents).toBe(938500);
  });
  it("F16: optante pelo Simples com dispensa configurada → nenhuma retenção; líquido = bruto", () => {
    const r = withholdings(1000000, rules, true);
    expect(r.totalCents).toBe(0);
    expect(r.netCents).toBe(1000000);
    expect(r.lines.every((l) => l.waived === "simples")).toBe(true);
  });
  it("valor mínimo: abaixo dele não retém", () => expect(withholdings(100000, [{ type: "iss", ratePct: 5, minBaseCents: 500000, waiveIfSimples: false }], false).totalCents).toBe(0));
  it("F6: total bruto negativo não sofre retenção e é levado ao mês seguinte", () => {
    const r = withholdings(-50000, rules, false);
    expect(r).toMatchObject({ totalCents: 0, netCents: 0, carryCents: -50000 });
    expect(monthGross({ pct: 0, tierAdjust: 0, fixedExec: 0, fixedMonthly: 0, guarantee: 0, commission: 0, usageFee: 0, adjustments: 0, carryIn: r.carryCents })).toBe(-50000);
  });
});

describe("Regras: prioridade, vigência e avisos (F2, F11, F15)", () => {
  const q = { professionalId: "p", role: "responsavel" as const, serviceId: "s1", category: "consulta" as const, on: "2026-10-10", unitId: "u1" };
  it("mais específica vence: serviço > categoria > padrão", () => {
    const rules = [rule({ id: "padrao" }), rule({ id: "cat", target_type: "category", category: "consulta" }), rule({ id: "svc", target_type: "service", service_id: "s1" })];
    expect(matchRules(rules, q).map((r) => r.id)).toEqual(["svc"]);
    expect(matchRules(rules, { ...q, serviceId: "s2" }).map((r) => r.id)).toEqual(["cat"]);
    expect(matchRules(rules, { ...q, serviceId: "s2", category: "sessao" }).map((r) => r.id)).toEqual(["padrao"]);
  });
  it("percentual e fixo por execução do mesmo nível valem juntos", () => {
    const rules = [rule({ id: "pct" }), rule({ id: "fx", rule_type: "fixed_per_exec", pct: null, amount_cents: 2000 })];
    expect(matchRules(rules, q).map((r) => r.id).sort()).toEqual(["fx", "pct"]);
  });
  it("F2: sem regra → lista vazia (fila «sem regra»)", () => expect(matchRules([rule({ professional_id: "outro" })], q)).toEqual([]));
  it("«sem repasse» marca explicitamente que o papel não é remunerado", () => {
    const lines = simulateAppointment([rule({ id: "n", rule_type: "none", pct: null })], CLINIC_FEE_ONLY, { serviceId: "s1", category: "consulta", on: "2026-10-10", unitId: "u1" }, [{ professionalId: "p", role: "responsavel" }],
      { grossCents: 50000, feeCents: 0, taxPct: 0, materialCents: 0 });
    expect(lines).toEqual([]);
  });
  it("regra encerrada, inativa ou de outra unidade não vale", () => {
    expect(matchRules([rule({ valid_to: "2026-10-09" })], q)).toEqual([]);
    expect(matchRules([rule({ is_active: false })], q)).toEqual([]);
    expect(matchRules([rule({ all_units: false, unit_ids: ["u2"] })], q)).toEqual([]);
    expect(matchRules([rule({ all_units: false, unit_ids: ["u1"] })], q)).toHaveLength(1);
  });
  it("F11: soma dos percentuais acima de 100% avisa", () => {
    const sum = pctSum([rule({ pct: 70 }), rule({ pct: 40 })]);
    expect(sum).toBe(110);
    expect(pctSumWarning(sum)).toBe(true);
    expect(pctSumWarning(pctSum([rule({ pct: 60 }), rule({ pct: 40 })]))).toBe(false);
  });
  it("F15: consulta R$ 500 com desconto de 10%, Pix, só taxa → base 450,00 e repasse 270,00", () => {
    const base = payoutBase({ grossCents: 45000, feeCents: 0, taxCents: 0, materialCents: 0 }, CLINIC_FEE_ONLY);
    expect(base).toBe(45000);
    expect(pctAmount(base, 60)).toBe(27000);
  });
  it("base nunca fica negativa (material maior que o recebido)", () => expect(payoutBase({ grossCents: 10000, feeCents: 0, taxCents: 0, materialCents: 20000 }, { fee: true, tax: false, material: true })).toBe(0));
  it("faixas no simulador usam a base acumulada do mês", () => {
    const tiers: Tier[] = [{ up_to_cents: 2000000, pct: 50 }, { up_to_cents: null, pct: 60 }];
    const l = simulateAppointment([rule({ pct: null, tiers })], CLINIC_FEE_ONLY, { serviceId: "s1", category: "consulta", on: "2026-10-10", unitId: null }, [{ professionalId: "p", role: "responsavel" }],
      { grossCents: 1500000, feeCents: 0, taxPct: 0, materialCents: 0, cumulativeBaseCents: 1500000 });
    expect(l[0]).toMatchObject({ pct: 60, amountCents: 900000 });
  });
});

describe("memória de cálculo para auditoria", () => {
  it("traduz a memória da linha do Exemplo A (taxa, imposto, regra e fórmula)", () => {
    const v = describeMemory({ origin: "avulso", service: "Consulta", performed_on: "2026-10-10", settled_date: "2026-11-09", gross_cents: 50000, fee_cents: 1500, tax_cents: 3000, tax_pct: 6, material_cents: 0,
      deductions: { fee: true, tax: true, material: false }, rule: { type: "pct", pct: 60, valid_from: "2026-01-01" }, formula: "base = 50000 − …" }, "pct");
    const get = (k: string) => v.rows.find(([l]) => l.startsWith(k))?.[1];
    expect(get("Valor liquidado")).toMatch(/500,00/);
    expect(get("Taxa")).toMatch(/15,00/);
    expect(get("Imposto")).toMatch(/30,00/);
    expect(v.rows.find(([l]) => l.startsWith("Material"))?.[0]).toMatch(/não deduzido/);
    expect(get("Regra aplicada")).toMatch(/Percentual sobre a base — 60% \(desde 01\/01\/2026\)/);
    expect(get("Liquidado") ?? get("Dinheiro")).toBe("09/11/2026");
    expect(v.formula).toContain("base");
    expect(get("Origem")).toBe("Venda do serviço (fora de pacote)");
    expect(v.correction).toBeNull();
  });
  it("mostra o estorno com o mês e os valores de origem", () => {
    const v = describeMemory({ correction: { reason: "chargeback", previous_amount: 30000, new_amount: 0, origin_period: "2026-06" } }, "adjustment");
    expect(v.correction).toMatch(/Estorno\/ajuste de lançamento de 06\/2026: de R\$\s300,00 para R\$\s0,00 — chargeback/);
  });
});

describe("conta do repasse em reais (D34c)", () => {
  it("troca os centavos por reais e mantém o percentual", () => {
    const f = formulaInReais("base = 30000 − taxa 0 − imposto 1800 − material 0 = 28200; repasse = base × 60%");
    expect(f).not.toMatch(/\b30000\b|\b1800\b/);
    expect(f).toMatch(/base = R\$\s300,00 − taxa R\$\s0,00 − imposto R\$\s18,00 − material R\$\s0,00 = R\$\s282,00; repasse = base × 60%/);
  });
});
