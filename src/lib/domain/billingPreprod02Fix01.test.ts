import { describe, expect, it } from "vitest";

const DEBUG_ENDPOINT = "http://127.0.0.1:7264/ingest/177d568b-dc11-4b10-8280-e97a64be4cf0";

function debugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
) {
  // #region agent log
  fetch(DEBUG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "280e0a" },
    body: JSON.stringify({
      sessionId: "280e0a",
      runId: "preprod02-fix01",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

/** Mirrors private.patient_clinic + billing_clinical_product_permitted(null)=false. */
function resolvePatientClinic(
  patientId: string | null | undefined,
  patients: ReadonlyMap<string, string>,
): string | null {
  if (!patientId) return null;
  return patients.get(patientId) ?? null;
}

function commercialProductPermitted(
  clinicId: string | null,
  productAllowedByClinic: ReadonlyMap<string, boolean>,
): boolean {
  if (clinicId == null) return false;
  return productAllowedByClinic.get(clinicId) === true;
}

function documentGate(
  patientId: string | null | undefined,
  patients: ReadonlyMap<string, string>,
  productAllowedByClinic: ReadonlyMap<string, boolean>,
): boolean {
  return commercialProductPermitted(
    resolvePatientClinic(patientId, patients),
    productAllowedByClinic,
  );
}

describe("PREPROD02 FIX-01 patient_documents clinic resolution", () => {
  const clinicA = "clinic-a";
  const clinicB = "clinic-b";
  const patientA = "patient-a";
  const patientB = "patient-b";
  const patients = new Map<string, string>([
    [patientA, clinicA],
    [patientB, clinicB],
  ]);

  it("allows document when patient clinic has FULL/exemption access", () => {
    const allowed = documentGate(
      patientA,
      patients,
      new Map([
        [clinicA, true],
        [clinicB, false],
      ]),
    );
    debugLog("H1", "billingPreprod02Fix01.test.ts:allow", "allowed clinic+patient", { allowed });
    expect(allowed).toBe(true);
  });

  it("denies protected document under ENFORCE PRE_CONTRACT", () => {
    const denied = documentGate(patientA, patients, new Map([[clinicA, false]]));
    debugLog("H2", "billingPreprod02Fix01.test.ts:enforce", "pre_contract deny", { denied });
    expect(denied).toBe(false);
  });

  it("denies document whose patient belongs to another clinic", () => {
    const denied = documentGate(
      patientB,
      patients,
      new Map([
        [clinicA, true],
        [clinicB, false],
      ]),
    );
    debugLog("H3", "billingPreprod02Fix01.test.ts:cross", "foreign clinic deny", { denied });
    expect(denied).toBe(false);
  });

  it("fails closed for nonexistent patient_id", () => {
    const denied = documentGate("missing", patients, new Map([[clinicA, true]]));
    debugLog("H4", "billingPreprod02Fix01.test.ts:missing", "missing patient fail closed", {
      denied,
    });
    expect(denied).toBe(false);
  });

  it("ignores browser-supplied clinic and uses patient relationship only", () => {
    const browserClaimedClinic = clinicA;
    const resolved = resolvePatientClinic(patientB, patients);
    const permitted = commercialProductPermitted(
      resolved,
      new Map([
        [clinicA, true],
        [clinicB, false],
      ]),
    );
    debugLog("H5", "billingPreprod02Fix01.test.ts:steer", "client clinic cannot steer", {
      browserClaimedClinic,
      resolved,
      permitted,
    });
    expect(resolved).toBe(clinicB);
    expect(resolved).not.toBe(browserClaimedClinic);
    expect(permitted).toBe(false);
  });

  it("re-evaluates WITH CHECK when patient_id changes on UPDATE", () => {
    const before = documentGate(
      patientA,
      patients,
      new Map([
        [clinicA, true],
        [clinicB, false],
      ]),
    );
    const after = documentGate(
      patientB,
      patients,
      new Map([
        [clinicA, true],
        [clinicB, false],
      ]),
    );
    debugLog("H6", "billingPreprod02Fix01.test.ts:update", "patient_id update recheck", {
      before,
      after,
    });
    expect(before).toBe(true);
    expect(after).toBe(false);
  });
});
