import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { StaffNotification } from "@/types/db";

const navigate = vi.hoisted(() => vi.fn());
const markRead = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  items: [] as StaffNotification[],
  unreadCount: 0,
  isLoading: false,
  isError: false,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/hooks/useStaffNotifications", () => ({
  useStaffNotifications: () => ({
    items: state.items,
    unreadCount: state.unreadCount,
    isLoading: state.isLoading,
    isError: state.isError,
    markRead,
  }),
}));

const { StaffNotificationsBell } = await import("./StaffNotificationsBell");

function row(over: Partial<StaffNotification> = {}): StaffNotification {
  return {
    id: "n-1",
    clinic_id: "c-1",
    recipient_profile_id: "pf-1",
    actor_profile_id: null,
    patient_id: "pac-9",
    channel_id: "ch-1",
    message_id: "msg-1",
    type: "help_requested",
    severity: "critical",
    created_at: new Date().toISOString(),
    read_at: null,
    ...over,
  };
}

function renderBell() {
  return render(<StaffNotificationsBell />);
}

describe("StaffNotificationsBell", () => {
  it("T4 — sem unread não mostra badge", () => {
    state.items = [];
    state.unreadCount = 0;
    renderBell();
    expect(screen.getByRole("button", { name: "Notificações" })).toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("T5 — unread 1 mostra badge 1", async () => {
    state.items = [row()];
    state.unreadCount = 1;
    renderBell();
    expect(screen.getByRole("button", { name: /1 não lidas/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /não lidas/i }));
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("T6 — unread > 99 mostra 99+", async () => {
    state.items = [row()];
    state.unreadCount = 120;
    renderBell();
    await userEvent.click(screen.getByRole("button", { name: /mais de 99/i }));
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("T7/T8 — SOS aparece crítico e sem corpo clínico", async () => {
    state.items = [row()];
    state.unreadCount = 1;
    renderBell();
    await userEvent.click(screen.getByRole("button", { name: /não lidas/i }));
    expect(screen.getByText("Pedido de ajuda")).toBeInTheDocument();
    expect(screen.getByText("Urgente")).toBeInTheDocument();
    expect(screen.queryByText(/Preciso de ajuda/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/diagn/i)).not.toBeInTheDocument();
  });

  it("T9/T10 — clicar marca lida e navega ao deep link", async () => {
    navigate.mockReset();
    markRead.mockReset();
    state.items = [row({ id: "n-sos", patient_id: "pac-9" })];
    state.unreadCount = 1;
    renderBell();
    await userEvent.click(screen.getByRole("button", { name: /não lidas/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Pedido de ajuda/i }));
    expect(markRead).toHaveBeenCalledWith("n-sos");
    expect(navigate).toHaveBeenCalledWith("/mensagens?patient=pac-9");
  });
});
