import { describe, expect, it } from "vitest";

import {
  QA2_CLINIC_ID,
  QA2_CLINIC_NAME,
  assertNotQa2,
  assertSyntheticSelector,
  createMasterE2eRun,
  evaluateCheckpoint,
  incrementProviderWrite,
  markStep,
  redactSecrets,
  resumeFrom,
  shouldCreateRemoteResource,
  simulateDuplicateClick,
  simulateTimeoutRetry,
} from "./billingProduct06MasterE2e";

describe("billingProduct06MasterE2e runner", () => {
  it("creates a unique run id and starts locally", () => {
    const a = createMasterE2eRun(new Date("2026-09-20T22:00:00Z"));
    const b = createMasterE2eRun(new Date("2026-09-20T22:00:01Z"));
    expect(a.runId).not.toBe(b.runId);
    expect(a.checkpoint).toBe("local_only");
    expect(a.providerWrites).toBe(0);
    expect(a.steps).toHaveLength(17);
  });

  it("hard-excludes QA #2 from selection and cleanup", () => {
    expect(() => assertNotQa2(QA2_CLINIC_ID, "other")).toThrow("QA2_EXCLUDED");
    expect(() => assertNotQa2("other", QA2_CLINIC_NAME)).toThrow("QA2_EXCLUDED");
    expect(() => assertSyntheticSelector({ clinicName: "Clinica Real" })).toThrow(
      "CLEANUP_SELECTOR_UNSAFE",
    );
    expect(() => assertSyntheticSelector({ namePrefix: "all-" })).toThrow("CLEANUP_SELECTOR_UNSAFE");
    expect(() => assertSyntheticSelector({ clinicName: "bp06-synth-1", clinicId: "c1" })).not.toThrow();
  });

  it("resumes the first unfinished step and does not recreate finished remote work", () => {
    let run = createMasterE2eRun();
    run = markStep(run, "S01_CREATE_SYNTHETIC_CLINIC", "done", { clinicId: "c-new" });
    expect(resumeFrom(run)).toBe("S02_CREATE_CLINIC_ADMIN");
    expect(shouldCreateRemoteResource(run, "S08_PIX_EXECUTE")).toBe(false);
    run = { ...run, checkpoint: "authorized" };
    expect(shouldCreateRemoteResource(run, "S08_PIX_EXECUTE")).toBe(true);
    run = markStep(run, "S08_PIX_EXECUTE", "done", { executed: true });
    expect(shouldCreateRemoteResource(run, "S08_PIX_EXECUTE")).toBe(false);
    expect(simulateDuplicateClick(run, "S08_PIX_EXECUTE")).toBe("reuse");
    expect(simulateTimeoutRetry(run, "S09_OBSERVE_AUTHORIZATION")).toBe("resume-same-step");
  });

  it("redacts secrets and blocks provider writes without the human checkpoint", () => {
    const run = createMasterE2eRun();
    expect(() => incrementProviderWrite(run)).toThrow("PROVIDER_WRITE_BLOCKED");
    expect(evaluateCheckpoint({ preflight: "GO" })).toBe("awaiting_human");
    expect(
      evaluateCheckpoint({ preflight: "GO", authorization: "AUTORIZADO BP06 MASTER E2E" }),
    ).toBe("authorized");
    const redacted = redactSecrets({
      access_token: "secret",
      encodedImage: "aaa",
      note: "ok",
      jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
    }) as Record<string, string>;
    expect(redacted.access_token).toBe("[redacted]");
    expect(redacted.encodedImage).toBe("[redacted]");
    expect(redacted.note).toBe("ok");
  });
});
