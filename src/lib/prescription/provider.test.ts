import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import { demoProvider, getPrescriptionProvider, ProviderNotAvailableError } from "@/lib/prescription";

const RAW = {
  session_id: "s1", provider: "demo", is_demo: true, doc_type: "receita", expires_at: "2026-11-19T12:00:00Z",
  patient: { name: "Paciente Fictício", birth_date: "1990-05-17", cpf: null, address: null },
  professional: { id: "pr1", name: "Profissional Fictício", registry_number: "CRN-3 000001", specialty: "Nutrição" },
  clinic: { id: "c1", name: "Clínica Fictícia" }, encounter_id: "e1", appointment_id: null,
};

beforeEach(() => { rpc.mockReset(); });

describe("adaptador de provedor de prescrição", () => {
  it("o padrão é o provedor de demonstração e o real ainda não está disponível", () => {
    expect(getPrescriptionProvider(undefined).id).toBe("demo");
    expect(getPrescriptionProvider("demo").isDemo).toBe(true);
    expect(() => getPrescriptionProvider("memed")).toThrow(ProviderNotAvailableError);
    expect(() => getPrescriptionProvider("nexodata")).toThrow(/PROVIDER_NOT_AVAILABLE/);
  });
  it("abrir sessão chama doc_open_session com paciente e atendimento e devolve os dados pré-preenchidos", async () => {
    rpc.mockResolvedValueOnce({ data: RAW, error: null });
    const s = await demoProvider.openSession({ clinicId: "c1", patientId: "p1", type: "receita", encounterId: "e1" });
    expect(rpc).toHaveBeenCalledWith("doc_open_session", { p_clinic: "c1", p_patient: "p1", p_type: "receita", p_encounter: "e1", p_appointment: null });
    expect(s).toMatchObject({ sessionId: "s1", isDemo: true, patient: { name: "Paciente Fictício", birthDate: "1990-05-17" }, professional: { registryNumber: "CRN-3 000001", specialty: "Nutrição" }, clinic: { name: "Clínica Fictícia" } });
  });
  it("assinar (demonstração) envia só os campos permitidos, CPF só com dígitos, e devolve o id do documento", async () => {
    rpc.mockResolvedValueOnce({ data: RAW, error: null }).mockResolvedValueOnce({ data: { document_id: "d1", already: false }, error: null });
    const s = await demoProvider.openSession({ clinicId: "c1", patientId: "p1", type: "receita" });
    const r = await demoProvider.sign!(s, { title: " Receita ", content: "x", items: [{ name: " Med ", dose: "1", posology: "2x", quantity: "3" }], patientCpf: "111.444.777-35", patientAddress: " Rua A " });
    expect(rpc).toHaveBeenLastCalledWith("doc_sign_demo", { p_session: "s1", p_title: "Receita", p_content: "x", p_items: [{ name: "Med", dose: "1", posology: "2x", quantity: "3" }], p_patient_extra: { cpf: "11144477735", address: "Rua A" } });
    expect(r).toEqual({ documentId: "d1", alreadySigned: false });
  });
  it("erro do servidor sobe para a tela (sem registro, por exemplo)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "REGISTRY_REQUIRED", code: "42501" } });
    await expect(demoProvider.openSession({ clinicId: "c1", patientId: "p1", type: "atestado" })).rejects.toMatchObject({ message: "REGISTRY_REQUIRED" });
  });
});
