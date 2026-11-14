import * as api from "@/lib/api/clinicalDocs";
import { cpfDigits, itemsForType } from "@/lib/domain/clinicalDocs";
import type { OpenSessionInput, PrescriptionProvider, PrescriptionSession, SignInput, SignResult } from "./types";

export function toSession(r: api.RawSession): PrescriptionSession {
  return {
    sessionId: r.session_id, provider: r.provider, isDemo: r.is_demo, type: r.doc_type, expiresAt: r.expires_at,
    patient: { name: r.patient.name, birthDate: r.patient.birth_date, cpf: r.patient.cpf, address: r.patient.address },
    professional: { id: r.professional.id, name: r.professional.name, registryNumber: r.professional.registry_number, specialty: r.professional.specialty },
    clinic: r.clinic, encounterId: r.encounter_id, appointmentId: r.appointment_id,
  };
}

/** Provedor em MODO DEMONSTRAÇÃO: o diálogo é da própria Vertexa e o documento sai marcado «sem validade legal». */
export const demoProvider: PrescriptionProvider = {
  id: "demo",
  label: "Demonstração",
  isDemo: true,
  async openSession(input: OpenSessionInput): Promise<PrescriptionSession> {
    return toSession(await api.openSession(input.clinicId, input.patientId, input.type, input.encounterId, input.appointmentId));
  },
  async sign(session: PrescriptionSession, input: SignInput): Promise<SignResult> {
    const cpf = cpfDigits(input.patientCpf ?? "");
    const r = await api.signDemo(session.sessionId, input.title.trim(), input.content, itemsForType(session.type, input.items), {
      ...(cpf ? { cpf } : {}), ...(input.patientAddress?.trim() ? { address: input.patientAddress.trim() } : {}),
    });
    return { documentId: r.document_id, alreadySigned: r.already };
  },
};
