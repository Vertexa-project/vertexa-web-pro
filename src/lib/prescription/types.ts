// Adaptador de provedor de prescrição (Entrega 9). A Vertexa não é motor de prescrição: integra um provedor.
// Esta interface é o ponto de troca: o provedor real (Memed, Nexodata…) implementa o mesmo contrato e é escolhido por clínica
// (fin_settings.doc_provider). O adaptador `demo` roda dentro da própria Vertexa e NÃO tem validade legal.
import type { DocType, PrescribedItem } from "@/lib/domain/clinicalDocs";

export type ProviderId = "demo" | "memed" | "nexodata";

export interface OpenSessionInput {
  clinicId: string; patientId: string; type: DocType;
  /** clinical_encounters.id (consulta assistida) */ encounterId?: string | null;
  /** fin_appointments.id (atendimento do financeiro) */ appointmentId?: string | null;
}

/** O que o provedor recebe já preenchido (escopo §10.2: paciente, profissional, clínica). */
export interface PrescriptionSession {
  sessionId: string; provider: ProviderId; isDemo: boolean; type: DocType; expiresAt: string;
  patient: { name: string; birthDate: string | null; cpf: string | null; address: string | null };
  professional: { id: string; name: string; registryNumber: string | null; specialty: string | null };
  clinic: { id: string; name: string };
  encounterId: string | null; appointmentId: string | null;
}

export interface SignInput { title: string; content: string; items: PrescribedItem[]; patientCpf?: string; patientAddress?: string }
export interface SignResult { documentId: string; alreadySigned: boolean }

export interface PrescriptionProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** true = simulação sem validade legal (mostrar a faixa DEMONSTRAÇÃO). */
  readonly isDemo: boolean;
  /** Abre a sessão no servidor (confere registro do profissional e acesso ao paciente) e devolve os dados pré-preenchidos. */
  openSession(input: OpenSessionInput): Promise<PrescriptionSession>;
  /**
   * Demo: assina dentro da Vertexa (RPC doc_sign_demo). Provedor real: NÃO existe — o profissional assina no widget do provedor
   * e o documento volta pelo webhook (doc_ingest_signed); a tela só espera `waitForSigned`.
   */
  sign?(session: PrescriptionSession, input: SignInput): Promise<SignResult>;
}

export class ProviderNotAvailableError extends Error {
  constructor(public readonly provider: string) { super(`PROVIDER_NOT_AVAILABLE: ${provider}`); }
}
