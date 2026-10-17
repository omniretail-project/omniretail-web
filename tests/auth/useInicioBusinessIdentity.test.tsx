// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInicioBusinessIdentity } from "@/modules/auth/hooks/useInicioBusinessIdentity";

const state = vi.hoisted(() => ({ apiMode: true, constructed: [] as unknown[][], execute: vi.fn() }));

vi.mock("@/config/api-mode", () => ({ isApiMode: () => state.apiMode }));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = {};
  return { useRepositories: () => repositories };
});
vi.mock("@/infrastructure/api/fetchPublicStoreIdentity", () => ({
  fetchPublicStoreIdentity: () => undefined,
}));
vi.mock("@/modules/auth/application/services/GetInicioBusinessIdentityService", () => ({
  GetInicioBusinessIdentityService: class {
    constructor(...args: unknown[]) {
      state.constructed.push(args);
    }
    execute = state.execute;
  },
}));

describe("useInicioBusinessIdentity", () => {
  beforeEach(() => {
    state.apiMode = true;
    state.constructed.length = 0;
    state.execute.mockReset();
  });

  it("en modo api entrega al servicio el lector de identidad publica", async () => {
    state.execute.mockResolvedValue({ businessName: "FerrePharma" });

    const { result } = renderHook(() => useInicioBusinessIdentity("tenant-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.identity).toEqual({ businessName: "FerrePharma" });
    expect(state.constructed[0][1]).toBeTypeOf("function");
  });

  it("en modo mock no usa el lector publico", async () => {
    state.apiMode = false;
    state.execute.mockResolvedValue({ businessName: "Mock" });

    const { result } = renderHook(() => useInicioBusinessIdentity("tenant-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.constructed[0][1]).toBeUndefined();
  });

  it("si el servicio falla marca error y sin tenant no consulta nada", async () => {
    state.execute.mockRejectedValue(new Error("x"));
    const failed = renderHook(() => useInicioBusinessIdentity("tenant-1"));
    await waitFor(() => expect(failed.result.current.error).toBe(true));

    state.execute.mockClear();
    const empty = renderHook(() => useInicioBusinessIdentity(null));
    await waitFor(() => expect(empty.result.current.loading).toBe(false));
    expect(state.execute).not.toHaveBeenCalled();
  });
});
