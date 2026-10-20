import { describe, expect, it } from "vitest";
import { availableAudiences, recipientsText, renderMessage, triggerMeta, validateBroadcast, validateCampaignEdit } from "./campaigns";

describe("campaigns domain", () => {
  it("{nome} vira o primeiro nome; sem nome vira 'você'", () => {
    expect(renderMessage("Oi, {nome}! {nome}", "  Maria da Silva ")).toBe("Oi, Maria! Maria");
    expect(renderMessage("Oi, {nome}", "")).toBe("Oi, você");
    expect(renderMessage("Oi, {nome}", null)).toBe("Oi, você");
  });
  it("edição: título e mensagem obrigatórios, com limites 80/500", () => {
    const meta = triggerMeta("checkin");
    const base = { title: "T", body: "B", days: "15" };
    expect(validateCampaignEdit({ ...base, title: " " }, meta).ok).toBe(false);
    expect(validateCampaignEdit({ ...base, body: "" }, meta).ok).toBe(false);
    expect(validateCampaignEdit({ ...base, title: "a".repeat(81) }, meta).ok).toBe(false);
    expect(validateCampaignEdit({ ...base, title: "a".repeat(80) }, meta).ok).toBe(true);
    expect(validateCampaignEdit({ ...base, body: "a".repeat(501) }, meta).ok).toBe(false);
    expect(validateCampaignEdit({ ...base, body: "a".repeat(500) }, meta).ok).toBe(true);
  });
  it("dias: só gatilhos com dias exigem 1–365 inteiro; os outros ignoram", () => {
    const meta = triggerMeta("reactivation");
    for (const bad of ["0", "366", "1.5", "abc", ""]) expect(validateCampaignEdit({ title: "T", body: "B", days: bad }, meta).ok).toBe(false);
    const ok = validateCampaignEdit({ title: "T", body: "B", days: "10" }, meta);
    expect(ok.ok && ok.value.days).toBe(10);
    const birthday = validateCampaignEdit({ title: "T", body: "B", days: "lixo" }, triggerMeta("birthday"));
    expect(birthday.ok && birthday.value.days).toBeNull();
  });
  it("disparo: audiência de inativos exige dias; as demais não", () => {
    expect(validateBroadcast({ title: "T", body: "B", audience: "mine_inactive", days: "" }).ok).toBe(false);
    const a = validateBroadcast({ title: "T", body: "B", audience: "all_inactive", days: "14" });
    expect(a.ok && a.value.days).toBe(14);
    const b = validateBroadcast({ title: "T", body: "B", audience: "mine", days: "" });
    expect(b.ok && b.value.days).toBeNull();
  });
  it("membro não vê audiências da clínica inteira", () => {
    expect(availableAudiences(false)).toEqual(["mine", "mine_inactive"]);
    expect(availableAudiences(true)).toEqual(["mine", "mine_inactive", "all", "all_inactive"]);
  });
  it("texto de destinatários", () => {
    expect(recipientsText(0)).toMatch(/Nenhum/);
    expect(recipientsText(1)).toBe("1 paciente vai receber.");
    expect(recipientsText(7)).toBe("7 pacientes vão receber.");
  });
  it("descrição do gatilho usa os dias configurados", () => {
    expect(triggerMeta("reactivation")?.when(10)).toMatch(/10 dias/);
    expect(triggerMeta("checkin")?.when(null)).toMatch(/15 dias/);
  });
});
