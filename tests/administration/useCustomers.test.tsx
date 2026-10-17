// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomers } from "@/modules/administration/hooks/useCustomers";

const state = vi.hoisted(() => ({
  apiMode: true,
  permissions: ["admin.customers.read"] as string[],
  apiList: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock("@/config/api-mode", () => ({ isApiMode: () => state.apiMode }));
// Referencia estable, como el provider real: si cambiara en cada render, el efecto se repetiria.
vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = {};
  return { useRepositories: () => repositories };
});
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({
    user: { tenantId: "tenant-1" },
    permissions: state.permissions,
    hasPermission: (key: string) => state.permissions.includes(key),
    loading: false,
  }),
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));
vi.mock("@/modules/administration/application/services/ApiCustomersService", () => ({
  ApiCustomersService: class {
    list = state.apiList;
  },
}));
vi.mock("@/modules/administration/application/services/GetCustomersService", () => ({
  GetCustomersService: class {
    execute = state.mockExecute;
  },
}));

const googleCustomer = { id: "c1", name: "Melbyn Xutuc", purchaseCount: 2, topProducts: [] };

describe("useCustomers", () => {
  beforeEach(() => {
    state.apiMode = true;
    state.permissions = ["admin.customers.read"];
    state.apiList.mockReset();
    state.mockExecute.mockReset();
  });

  it("en modo api lista los clientes del backend (incluidos los de Google)", async () => {
    state.apiList.mockResolvedValue([googleCustomer]);

    const { result } = renderHook(() => useCustomers());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.customers).toEqual([googleCustomer]);
    expect(result.current.error).toBeNull();
    expect(state.mockExecute).not.toHaveBeenCalled();
  });

  it("en modo mock sigue usando el servicio local", async () => {
    state.apiMode = false;
    state.mockExecute.mockResolvedValue([googleCustomer]);

    const { result } = renderHook(() => useCustomers());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.customers).toEqual([googleCustomer]);
    expect(state.apiList).not.toHaveBeenCalled();
  });

  it("sin permiso de lectura no llama al backend y muestra el error", async () => {
    state.permissions = [];

    const { result } = renderHook(() => useCustomers());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.apiList).not.toHaveBeenCalled();
    expect(result.current.customers).toEqual([]);
    expect(result.current.error).toBeTruthy();
    expect(result.current.canRead).toBe(false);
  });

  it("si el backend falla expone el error y deja la lista vacia", async () => {
    state.apiList.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useCustomers());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.customers).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });

  it("reload vuelve a pedir los clientes", async () => {
    state.apiList.mockResolvedValueOnce([]).mockResolvedValueOnce([googleCustomer]);

    const { result } = renderHook(() => useCustomers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const reloaded = await result.current.reload();

    expect(reloaded).toEqual([googleCustomer]);
    await waitFor(() => expect(result.current.customers).toEqual([googleCustomer]));
  });
});
