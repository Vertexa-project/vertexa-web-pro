import { describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ data: [] as unknown[], rpc: [] as unknown[] | null }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: st.data, error: null }) }) }),
    rpc: () => Promise.resolve(st.rpc ? { data: st.rpc, error: null } : { data: null, error: { message: "x" } }),
  },
}));
const { listPatients, latestOf } = await import("./patients");

const row = (id: string, ev: string | null, w: string | null = null) => ({
  id, goal: null, current_weight: null, start_date: null, birth_date: null,
  profile: { full_name: id, email: null, avatar_url: null, avatar_path: null, status: "active" },
  adherence_snapshots: [], professional_patient_links: [],
  activity_events: ev ? [{ type: "checkin", created_at: ev }] : [], weight_logs: w ? [{ measured_at: w }] : [], progress_photos: [],
});

describe("listPatients — última atividade", () => {
  it("conta a mensagem do paciente na conversa quando é a mais recente", async () => {
    st.data = [row("m", "2026-11-16T22:00:00+00:00")];
    st.rpc = [{ patient_id: "m", last_at: "2026-11-17T21:30:00+00:00" }];
    const [p] = await listPatients();
    expect(p.lastActivityAt).toBe("2026-11-17T21:30:00+00:00");
  });
  it("conta o peso registrado e segue sem o sinal da conversa se a consulta falhar", async () => {
    st.data = [row("m", "2026-11-10T10:00:00+00:00", "2026-11-12T10:00:00+00:00")];
    st.rpc = null;
    const [p] = await listPatients();
    expect(p.lastActivityAt).toBe("2026-11-12T10:00:00+00:00");
  });
  it("latestOf compara pelo instante, não pelo texto", () => {
    expect(latestOf("2026-11-17T23:00:00-03:00", "2026-11-18T01:30:00+00:00", null)).toBe("2026-11-17T23:00:00-03:00");
    expect(latestOf(null, undefined)).toBeNull();
  });
});
