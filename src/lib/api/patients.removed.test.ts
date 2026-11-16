import { describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ order: () => Promise.resolve({ data: rows.data, error: null }) }) }) },
}));
const { listPatients } = await import("./patients");

const row = (id: string, name: string, status: string) => ({
  id, goal: null, current_weight: null, start_date: null, birth_date: null,
  profile: { full_name: name, email: null, avatar_url: null, avatar_path: null, status },
  adherence_snapshots: [], professional_patient_links: [], activity_events: [], weight_logs: [], progress_photos: [],
});

describe("listPatients — paciente removido", () => {
  it("não lista o paciente anonimizado (Pacientes, KPIs, Foco, Reativar e Pendências leem daqui)", async () => {
    rows.data = [row("a", "Ana", "active"), row("r", "Paciente removido", "inactive")];
    const list = await listPatients();
    expect(list.map((p) => p.id)).toEqual(["a"]);
    expect(list[0].profile).not.toHaveProperty("status");
  });
});
