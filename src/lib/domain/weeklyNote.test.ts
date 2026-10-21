import { describe, expect, it } from "vitest";
import { mondayKey, noteError, NOTE_MAX } from "./weeklyNote";

describe("recado semanal", () => {
  it("segunda-feira da semana, inclusive no domingo e na própria segunda", () => {
    expect(mondayKey(new Date(2026, 9, 21))).toBe("2026-10-19"); // quarta
    expect(mondayKey(new Date(2026, 9, 25))).toBe("2026-10-19"); // domingo ainda é da semana que começou na segunda
    expect(mondayKey(new Date(2026, 9, 26))).toBe("2026-10-26"); // segunda
    expect(mondayKey(new Date(2026, 10, 1))).toBe("2026-10-26"); // virada de mês (domingo)
  });
  it("limite de 300 caracteres; vazio é permitido", () => {
    expect(noteError("")).toBeNull();
    expect(noteError("x".repeat(NOTE_MAX))).toBeNull();
    expect(noteError("x".repeat(NOTE_MAX + 1))).toContain("300");
    expect(noteError(" ".repeat(400))).toBeNull();
  });
});
