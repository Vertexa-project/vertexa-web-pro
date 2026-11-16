import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/lib/api/documents", () => ({ uploadPatientDocument: h.upload }));

import { revokeDelivery, savePdfAndSend, sendDocumentToPatient } from "./deliveries";

beforeEach(() => {
  h.rpc.mockReset();
  h.upload.mockReset();
});

describe("enviar PDF ao app do paciente", () => {
  it("guarda o PDF em Documentos como relatório da clínica e só então envia (quem enviou fica no registro do banco)", async () => {
    h.upload.mockResolvedValue({ id: "doc-1" });
    h.rpc.mockResolvedValue({ data: "dv-1", error: null });
    const r = await savePdfAndSend({ patientId: "p1", professionalId: "pr1", blob: new Blob(["%PDF-1"], { type: "application/pdf" }), fileName: "treino-ana-2026-11-16.pdf", kind: "treino", title: "Treino · Ficha" });
    expect(r).toEqual({ documentId: "doc-1", deliveryId: "dv-1" });
    const up = h.upload.mock.calls[0][0];
    expect(up).toMatchObject({ patientId: "p1", kind: "report", title: "Treino · Ficha", uploadedByRole: "professional", uploadedByProfessionalId: "pr1" });
    expect(up.file.type).toBe("application/pdf");
    expect(h.rpc).toHaveBeenCalledWith("send_document_to_patient", { p_document_id: "doc-1", p_kind: "treino", p_title: "Treino · Ficha", p_notify: true });
  });
  it("se o envio falhar o PDF já está em Documentos (não envia arquivo duplicado na nova tentativa) e o erro sobe", async () => {
    h.upload.mockResolvedValue({ id: "doc-2" });
    h.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    await expect(savePdfAndSend({ patientId: "p1", professionalId: "pr1", blob: new Blob(["x"]), fileName: "a.pdf", kind: "plano_alimentar", title: "Plano" })).rejects.toMatchObject({ code: "42501" });
    expect(h.upload).toHaveBeenCalledTimes(1);
  });
  it("documento que já está em Documentos usa o mesmo caminho do banco; retirar chama revoke_delivery", async () => {
    h.rpc.mockResolvedValue({ data: "dv-9", error: null });
    expect(await sendDocumentToPatient("doc-9", "documento", null)).toBe("dv-9");
    expect(h.rpc).toHaveBeenCalledWith("send_document_to_patient", { p_document_id: "doc-9", p_kind: "documento", p_title: null, p_notify: true });
    h.rpc.mockResolvedValue({ error: null });
    await revokeDelivery("dv-9");
    expect(h.rpc).toHaveBeenLastCalledWith("revoke_delivery", { p_delivery_id: "dv-9" });
  });
});
