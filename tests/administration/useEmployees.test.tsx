// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEmployees } from "@/modules/administration/hooks/useEmployees";

const state = vi.hoisted(() => ({
  getExecute: vi.fn(),
  updateExecute: vi.fn(),
  createExecute: vi.fn(),
}));

// Referencia estable, como el provider real: si cambiara en cada render, el efecto se repetiria.
vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = {
    roles: { listByTenant: vi.fn().mockResolvedValue([]) },
    branches: { getActiveByTenant: vi.fn().mockResolvedValue([]) },
  };
  return { useRepositories: () => repositories };
});
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({
    user: { tenantId: "tenant-1", id: "actor-1" },
    permissions: ["admin.users.manage"],
    hasPermission: () => true,
    loading: false,
  }),
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));
vi.mock("@/modules/administration/application/services/GetEmployeesService", () => ({
  GetEmployeesService: class {
    execute = state.getExecute;
  },
}));
vi.mock("@/modules/administration/application/services/UpdateEmployeeService", () => ({
  UpdateEmployeeService: class {
    execute = state.updateExecute;
  },
}));
vi.mock("@/modules/administration/application/services/CreateEmployeeService", () => ({
  CreateEmployeeService: class {
    execute = state.createExecute;
  },
}));
vi.mock("@/modules/administration/application/services/ResendInvitationService", () => ({
  ResendInvitationService: class {
    execute = vi.fn();
  },
}));

const dto = { name: "Inventario Demo" } as never;

describe("useEmployees mutaciones", () => {
  beforeEach(() => {
    state.getExecute.mockReset().mockResolvedValue([]);
    state.updateExecute.mockReset();
    state.createExecute.mockReset();
  });

  it("devuelve el resultado de editar un empleado", async () => {
    state.updateExecute.mockResolvedValue({ id: "e1" });
    const { result } = renderHook(() => useEmployees());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.update("e1", dto)).resolves.toEqual({ id: "e1" });

    expect(state.updateExecute).toHaveBeenCalledWith(
      "tenant-1",
      "e1",
      dto,
      ["admin.users.manage"],
      "actor-1",
    );
    expect(result.current.busy).toBe(false);
  });

  it("un fallo de edicion se relanza al formulario y NO llena el banner de la lista", async () => {
    state.updateExecute.mockRejectedValue(new Error("fallo al guardar"));
    const { result } = renderHook(() => useEmployees());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.update("e1", dto)).rejects.toThrow();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("un fallo al cargar la lista si se expone en error", async () => {
    state.getExecute.mockRejectedValue(new Error("no se pudo cargar"));

    const { result } = renderHook(() => useEmployees());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.employees).toEqual([]);
  });

  it("crear usa el mismo flujo de mutacion", async () => {
    state.createExecute.mockResolvedValue({ employee: { id: "e2" }, invitationToken: "t" });
    const { result } = renderHook(() => useEmployees());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.create(dto)).resolves.toMatchObject({ invitationToken: "t" });
  });
});
