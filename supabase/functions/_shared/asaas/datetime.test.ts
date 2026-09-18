import { afterEach, describe, expect, it, vi } from "vitest";

import { ASAAS_PROVIDER_TIMEZONE, parseAsaasDateTime } from "./datetime.js";
import { PIX_AUTOMATIC_POLICY } from "./pixAutomatic.ts";
import { parseEventCreatedAt } from "../asaasWebhook.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const NAIVE_WALL = "2026-09-18 12:49:52";
const NAIVE_BR = "18/09/2026 12:49:52";
const EXPECTED_INSTANT = "2026-09-18T15:49:52.000Z";

describe("Asaas datetime contract", () => {
  it("uses the existing Pix Automatic timezone policy", () => {
    expect(ASAAS_PROVIDER_TIMEZONE).toBe("America/Sao_Paulo");
    expect(PIX_AUTOMATIC_POLICY.timezone).toBe(ASAAS_PROVIDER_TIMEZONE);
    expect(PIX_AUTOMATIC_POLICY.immediateQrExpirationSeconds).toBe(3600);
  });

  it("maps naive YYYY-MM-DD HH:mm:ss to America/Sao_Paulo, not host TZ", () => {
    const spy = vi.spyOn(Date, "parse");
    expect(parseAsaasDateTime(NAIVE_WALL)).toBe(EXPECTED_INSTANT);
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps Brazilian day-first naive datetime to the same instant", () => {
    const spy = vi.spyOn(Date, "parse");
    expect(parseAsaasDateTime(NAIVE_BR)).toBe(EXPECTED_INSTANT);
    expect(parseAsaasDateTime(NAIVE_BR)).toBe(parseAsaasDateTime(NAIVE_WALL));
    expect(spy).not.toHaveBeenCalled();
  });

  it("respects ISO Z", () => {
    expect(parseAsaasDateTime("2026-09-18T12:49:52.000Z")).toBe("2026-09-18T12:49:52.000Z");
    expect(parseAsaasDateTime("2026-09-18T12:49:52Z")).toBe("2026-09-18T12:49:52.000Z");
  });

  it("respects ISO explicit offset", () => {
    expect(parseAsaasDateTime("2026-09-18T12:49:52-03:00")).toBe(EXPECTED_INSTANT);
    expect(parseAsaasDateTime("2026-09-18T15:49:52+00:00")).toBe(EXPECTED_INSTANT);
  });

  it("returns null for invalid input", () => {
    expect(parseAsaasDateTime(null)).toBeNull();
    expect(parseAsaasDateTime("")).toBeNull();
    expect(parseAsaasDateTime("not-a-date")).toBeNull();
    expect(parseAsaasDateTime("2026-13-40 12:00:00")).toBeNull();
    expect(parseAsaasDateTime("32/13/2026 12:49:52")).toBeNull();
    expect(parseAsaasDateTime("2026-09-18")).toBeNull();
    expect(parseAsaasDateTime(20260918)).toBeNull();
  });

  it("aligns QR expirationDate with CREATE + expirationSeconds", () => {
    const createdAt = Date.parse("2026-09-18T14:49:53.000Z");
    const ttlMs = PIX_AUTOMATIC_POLICY.immediateQrExpirationSeconds * 1000;
    const ttlExpiry = createdAt + ttlMs;
    const parsedExpiry = Date.parse(parseAsaasDateTime(NAIVE_WALL) ?? "");
    expect(parsedExpiry).toBe(Date.parse(EXPECTED_INSTANT));
    expect(Math.abs(parsedExpiry - ttlExpiry)).toBeLessThanOrEqual(1000);
  });

  it("aligns the historical REFUSED sample with provider TTL", () => {
    const createMs = Date.parse("2026-09-18T14:49:53.225Z");
    const parsedExpiry = Date.parse(parseAsaasDateTime(NAIVE_BR) ?? "");
    const refusedMs = Date.parse("2026-09-18T15:50:05.649Z");
    expect(parsedExpiry).toBe(Date.parse(EXPECTED_INSTANT));
    expect(parsedExpiry - createMs).toBeGreaterThan(3590_000);
    expect(parsedExpiry - createMs).toBeLessThan(3610_000);
    expect(refusedMs - parsedExpiry).toBeGreaterThan(0);
    expect(refusedMs - parsedExpiry).toBeLessThan(30_000);
  });

  it("parseEventCreatedAt shares the canonical parser", () => {
    expect(parseEventCreatedAt(NAIVE_WALL)).toBe(EXPECTED_INSTANT);
    expect(parseEventCreatedAt("2024-06-12 16:45:03")).toBe("2024-06-12T19:45:03.000Z");
    expect(parseEventCreatedAt("bad")).toBeNull();
  });
});
