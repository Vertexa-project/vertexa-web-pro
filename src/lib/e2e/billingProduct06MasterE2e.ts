export const QA2_CLINIC_ID = "e8727e86-a9c4-42d6-bfd0-886c2b752f4e";
export const QA2_CLINIC_NAME = "Vertexa QA Sandbox Billing";
export const MASTER_E2E_AUTHORIZATION_PHRASE = "AUTORIZADO BP06 MASTER E2E";

export const MASTER_E2E_STEPS = [
  "S01_CREATE_SYNTHETIC_CLINIC",
  "S02_CREATE_CLINIC_ADMIN",
  "S03_LIST_PLANS",
  "S04_UPSERT_IDENTITY",
  "S05_CREATE_CONTRACT",
  "S06_ENSURE_SANDBOX_CUSTOMER",
  "S07_PIX_PREPARE",
  "S08_PIX_EXECUTE",
  "S09_OBSERVE_AUTHORIZATION",
  "S10_CLINIC_HUB_VISIBLE",
  "S11_PLATFORM_BILLING_VISIBLE",
  "S12_REPORTS_VISIBLE",
  "S13_REFUSED_ISOLATED",
  "S14_REISSUE",
  "S15_FIXTURE_OVERDUE",
  "S16_SECURITY_MATRIX",
  "S17_CLEANUP_OR_RETAIN",
] as const;

export type MasterE2eStepId = (typeof MASTER_E2E_STEPS)[number];
export type MasterE2eStepStatus = "pending" | "done" | "blocked" | "skipped";

export interface MasterE2eStepState {
  id: MasterE2eStepId;
  status: MasterE2eStepStatus;
  remoteWrite: boolean;
  evidence: Record<string, string | number | boolean | null>;
}

export interface MasterE2eRun {
  runId: string;
  createdAt: string;
  syntheticClinicId: string | null;
  appVersion: string | null;
  migrationLatest: string | null;
  providerWrites: number;
  checkpoint: "local_only" | "awaiting_human" | "authorized";
  steps: MasterE2eStepState[];
}

const SECRET_KEYS = [
  "service_role",
  "api_key",
  "access_token",
  "refresh_token",
  "jwt",
  "magic_link",
  "encodedImage",
  "encoded_image",
  "qr",
  "qr_payload",
  "webhook_payload",
  "raw_payload",
];

export function createMasterE2eRunId(now = new Date()): string {
  return `bp06-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMasterE2eRun(now = new Date()): MasterE2eRun {
  return {
    runId: createMasterE2eRunId(now),
    createdAt: now.toISOString(),
    syntheticClinicId: null,
    appVersion: null,
    migrationLatest: null,
    providerWrites: 0,
    checkpoint: "local_only",
    steps: MASTER_E2E_STEPS.map((id) => ({
      id,
      status: "pending",
      remoteWrite: [
        "S06_ENSURE_SANDBOX_CUSTOMER",
        "S08_PIX_EXECUTE",
        "S14_REISSUE",
      ].includes(id),
      evidence: {},
    })),
  };
}

export function assertNotQa2(clinicId?: string | null, clinicName?: string | null): void {
  const id = (clinicId ?? "").toLowerCase();
  const name = (clinicName ?? "").trim().toLowerCase();
  if (id === QA2_CLINIC_ID || name === QA2_CLINIC_NAME.toLowerCase()) {
    throw new Error("QA2_EXCLUDED");
  }
}

export function assertSyntheticSelector(selector: { clinicId?: string; clinicName?: string; namePrefix?: string }): void {
  assertNotQa2(selector.clinicId, selector.clinicName);
  if (selector.namePrefix && !/^bp06[-_]/i.test(selector.namePrefix)) {
    throw new Error("CLEANUP_SELECTOR_UNSAFE");
  }
  if (selector.clinicName && !/^bp06[-_]/i.test(selector.clinicName)) {
    throw new Error("CLEANUP_SELECTOR_UNSAFE");
  }
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    if (SECRET_KEYS.some((key) => value.toLowerCase().includes(key))) return "[redacted]";
    if (/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]+/.test(value)) return "[redacted-jwt]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret.toLowerCase()))
          ? "[redacted]"
          : redactSecrets(inner),
      ]),
    );
  }
  return value;
}

export function markStep(
  run: MasterE2eRun,
  stepId: MasterE2eStepId,
  status: MasterE2eStepStatus,
  evidence: MasterE2eStepState["evidence"] = {},
): MasterE2eRun {
  return {
    ...run,
    steps: run.steps.map((step) =>
      step.id === stepId
        ? { ...step, status, evidence: redactSecrets(evidence) as MasterE2eStepState["evidence"] }
        : step,
    ),
  };
}

export function resumeFrom(run: MasterE2eRun): MasterE2eStepId | null {
  const next = run.steps.find((step) => step.status === "pending" || step.status === "blocked");
  return next?.id ?? null;
}

export function shouldCreateRemoteResource(run: MasterE2eRun, stepId: MasterE2eStepId): boolean {
  const step = run.steps.find((item) => item.id === stepId);
  if (!step) return false;
  if (step.status === "done") return false;
  if (!step.remoteWrite) return false;
  return run.checkpoint === "authorized";
}

export function evaluateCheckpoint(input: {
  preflight?: string;
  authorization?: string;
}): MasterE2eRun["checkpoint"] {
  if (input.preflight === "GO" && input.authorization === MASTER_E2E_AUTHORIZATION_PHRASE) {
    return "authorized";
  }
  if (input.preflight === "GO") return "awaiting_human";
  return "local_only";
}

export function incrementProviderWrite(run: MasterE2eRun): MasterE2eRun {
  if (run.checkpoint !== "authorized") {
    throw new Error("PROVIDER_WRITE_BLOCKED");
  }
  return { ...run, providerWrites: run.providerWrites + 1 };
}

export function simulateDuplicateClick(run: MasterE2eRun, stepId: MasterE2eStepId): "reuse" | "blocked" {
  const step = run.steps.find((item) => item.id === stepId);
  if (!step) return "blocked";
  if (step.status === "done") return "reuse";
  return "blocked";
}

export function simulateTimeoutRetry(run: MasterE2eRun, stepId: MasterE2eStepId): "resume-same-step" | "new-run" {
  const step = run.steps.find((item) => item.id === stepId);
  if (step && step.status !== "done") return "resume-same-step";
  return "resume-same-step";
}
