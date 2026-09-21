import { describe, expect, it } from "vitest";

import {
  assertSandboxFixtureEnvironment,
  PRODUCTION_FIXTURE_FORBIDDEN,
} from "./productionWriteGuard.ts";

describe("PA fixture Production hardening", () => {
  it("allows sandbox fixtures and rejects Production", () => {
    expect(assertSandboxFixtureEnvironment("sandbox")).toEqual({ ok: true });
    expect(assertSandboxFixtureEnvironment("production")).toEqual({
      ok: false,
      error: PRODUCTION_FIXTURE_FORBIDDEN,
    });
  });
});
