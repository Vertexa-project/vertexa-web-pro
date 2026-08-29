import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const amIPlatformAdmin = vi.hoisted(() => vi.fn());
const listPlatformClinics = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/platformAdmin", () => ({
  amIPlatformAdmin,
  listPlatformClinics,
}));

const { useAmIPlatformAdmin } = await import("./useAmIPlatformAdmin");
const { usePlatformClinics } = await import("./usePlatformClinics");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  amIPlatformAdmin.mockReset();
  listPlatformClinics.mockReset();
});

describe("useAmIPlatformAdmin", () => {
  it("true da RPC chega como true", async () => {
    amIPlatformAdmin.mockResolvedValue(true);
    const { result } = renderHook(() => useAmIPlatformAdmin(true), { wrapper });
    await waitFor(() => expect(result.current.isPlatformAdmin).toBe(true));
    expect(result.current.isError).toBe(false);
  });

  it("false da RPC chega como false (não como erro)", async () => {
    amIPlatformAdmin.mockResolvedValue(false);
    const { result } = renderHook(() => useAmIPlatformAdmin(true), { wrapper });
    await waitFor(() => expect(result.current.isPlatformAdmin).toBe(false));
    expect(result.current.isError).toBe(false);
  });

  it("erro NÃO vira false — permanece isError com isPlatformAdmin undefined", async () => {
    amIPlatformAdmin.mockRejectedValue(new Error("rpc down"));
    const { result } = renderHook(() => useAmIPlatformAdmin(true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPlatformAdmin).toBeUndefined();
  });

  it("enabled=false não chama a RPC", async () => {
    const { result } = renderHook(() => useAmIPlatformAdmin(false), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(amIPlatformAdmin).not.toHaveBeenCalled();
    expect(result.current.isPlatformAdmin).toBeUndefined();
  });
});

describe("usePlatformClinics", () => {
  it("enabled=false não consulta o catálogo", async () => {
    const { result } = renderHook(() => usePlatformClinics(false), { wrapper });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(listPlatformClinics).not.toHaveBeenCalled();
  });

  it("enabled=true chama só listPlatformClinics", async () => {
    listPlatformClinics.mockResolvedValue([]);
    const { result } = renderHook(() => usePlatformClinics(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listPlatformClinics).toHaveBeenCalledTimes(1);
  });
});
