import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryStatus, LocationStatus } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { useCategories } from "@/modules/catalog/hooks/useCategories";
import { useLocations } from "@/modules/catalog/hooks/useLocations";

/**
 * Hooks REALES (useCategories / useLocations) sobre servicios REALES (GetCategoriesService /
 * GetLocationsService). Solo se simulan la sesion, el registro de repositorios y los eventos.
 */
const mocks = vi.hoisted(() => ({
  permissions: { current: [] as string[] },
  branch: { current: { id: "branch-north" } as { id: string } | undefined, loading: false },
  registry: {} as Record<string, unknown>,
  eventHandlers: new Map<string, () => void>(),
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.registry,
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({
    hasPermission: (permission: string) => mocks.permissions.current.includes(permission),
  }),
}));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => ({
    currentBranch: mocks.branch.current,
    loading: mocks.branch.loading,
  }),
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({
  useDataEvent: (name: string, handler: () => void) => {
    mocks.eventHandlers.set(name, handler);
  },
}));
vi.mock("@/modules/catalog/application/services/serviceHelpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/catalog/application/services/serviceHelpers")>()),
  resolveTenantContext: async () => ({
    tenantId: "tenant-1",
    permissions: mocks.permissions.current,
  }),
}));

const TS = "2026-10-09T12:00:00.000Z";
const getByTenantWithCounts = vi.fn();
const getLocationsWithCounts = vi.fn();

function categoryEntry(id: string, name: string, productCount: number | null = 3) {
  return {
    category: {
      id,
      tenantId: "tenant-1",
      name,
      slug: name.toLowerCase(),
      status: CategoryStatus.active,
      createdAt: TS,
      updatedAt: TS,
    },
    counts: { productCount, archivedProductCount: 0 },
  };
}

function locationEntry(id: string, name: string, branchId: string, count: number | null = 2) {
  return {
    location: {
      id,
      tenantId: "tenant-1",
      branchId,
      code: name.toUpperCase(),
      name,
      type: "aisle",
      status: LocationStatus.active,
      createdAt: TS,
      updatedAt: TS,
    },
    assignedProductCount: count,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "api");
  getByTenantWithCounts.mockReset();
  getLocationsWithCounts.mockReset();
  mocks.eventHandlers.clear();
  mocks.permissions.current = ["catalog.categories.read", "catalog.locations.read"];
  mocks.branch.current = { id: "branch-north" };
  mocks.branch.loading = false;
  mocks.registry = {
    categories: { getByTenantWithCounts },
    inventory: { getLocationsWithCounts },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("useCategories load states", () => {
  it("starts loading, then exposes the categories with their real counts and no error", async () => {
    getByTenantWithCounts.mockResolvedValue([categoryEntry("c1", "Herramientas", 25), categoryEntry("c2", "Pinturas", 0)]);

    const { result } = renderHook(() => useCategories());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBeNull();
    expect(result.current.categories.map((item) => [item.name, item.productCount])).toEqual([
      ["Herramientas", 25],
      ["Pinturas", 0],
    ]);
  });

  it("reports a truly empty list as empty, without any error", async () => {
    getByTenantWithCounts.mockResolvedValue([]);

    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.categories).toEqual([]);
    expect(result.current.loadError).toBeNull();
  });

  it("keeps the backend's message when the request is rejected, and never reports an empty list as success", async () => {
    getByTenantWithCounts.mockRejectedValue(new BackendRequestError("Error interno del servidor", 500, "INTERNAL"));

    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe("Error interno del servidor");
    expect(result.current.categories).toEqual([]);
  });

  it("shows a safe generic message for an unexpected network failure, without leaking the exception", async () => {
    getByTenantWithCounts.mockRejectedValue(new TypeError("fetch failed at http://10.0.0.5:8080/secret"));

    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe("No se pudo completar la operacion. Intentalo de nuevo.");
    expect(result.current.loadError).not.toContain("10.0.0.5");
  });

  it("surfaces the permission error and keeps canRead false for a role without read access", async () => {
    mocks.permissions.current = [];

    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canRead).toBe(false);
    expect(result.current.loadError).toMatch(/permisos/);
    expect(getByTenantWithCounts).not.toHaveBeenCalled();
  });

  it("lets a role with only manage access read", async () => {
    mocks.permissions.current = ["catalog.categories.manage"];
    getByTenantWithCounts.mockResolvedValue([categoryEntry("c1", "Herramientas")]);

    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canRead).toBe(true);
    expect(result.current.categories).toHaveLength(1);
  });

  it("recovers on retry: the error clears and the list appears", async () => {
    getByTenantWithCounts.mockRejectedValueOnce(new BackendRequestError("Sin conexión", 0));
    getByTenantWithCounts.mockResolvedValue([categoryEntry("c1", "Herramientas")]);
    const { result } = renderHook(() => useCategories());
    await waitFor(() => expect(result.current.loadError).toBe("Sin conexión"));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.loadError).toBeNull();
    expect(result.current.categories.map((item) => item.name)).toEqual(["Herramientas"]);
  });

  it("only the latest request wins when responses arrive out of order", async () => {
    const slow = deferred<unknown[]>();
    getByTenantWithCounts.mockReturnValueOnce(slow.promise);
    getByTenantWithCounts.mockResolvedValueOnce([categoryEntry("c2", "Nueva")]);
    const { result } = renderHook(() => useCategories());
    // La carga inicial (la lenta) ya esta en vuelo cuando llega la segunda consulta.
    await waitFor(() => expect(getByTenantWithCounts).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.reload();
    });
    await act(async () => {
      slow.resolve([categoryEntry("c1", "Vieja")]);
      await slow.promise;
    });

    expect(result.current.categories.map((item) => item.name)).toEqual(["Nueva"]);
    expect(result.current.loading).toBe(false);
  });

  it("reloads when a product changes so the counts stay current", async () => {
    getByTenantWithCounts.mockResolvedValueOnce([categoryEntry("c1", "Herramientas", 1)]);
    getByTenantWithCounts.mockResolvedValueOnce([categoryEntry("c1", "Herramientas", 2)]);
    const { result } = renderHook(() => useCategories());
    await waitFor(() => expect(result.current.categories[0]?.productCount).toBe(1));

    await act(async () => {
      mocks.eventHandlers.get("product.changed")?.();
    });

    await waitFor(() => expect(result.current.categories[0]?.productCount).toBe(2));
  });
});

describe("useLocations load states", () => {
  it("is loading before the first response: the list is pending, not empty", async () => {
    const pending = deferred<unknown[]>();
    getLocationsWithCounts.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useLocations());

    expect(result.current.loading).toBe(true);
    expect(result.current.loadError).toBeNull();
    await act(async () => {
      pending.resolve([locationEntry("l1", "Pasillo", "branch-north")]);
      await pending.promise;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locations.map((item) => item.productCount)).toEqual([2]);
  });

  it("reports a truly empty branch as empty, without any error", async () => {
    getLocationsWithCounts.mockResolvedValue([]);

    const { result } = renderHook(() => useLocations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locations).toEqual([]);
    expect(result.current.loadError).toBeNull();
  });

  it("keeps the backend's message for a rejected request", async () => {
    getLocationsWithCounts.mockRejectedValue(new BackendRequestError("Sin acceso a la sucursal", 403, "ACCESS_DENIED"));

    const { result } = renderHook(() => useLocations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe("Sin acceso a la sucursal");
    expect(result.current.locations).toEqual([]);
  });

  it("shows a safe generic message for an unexpected failure", async () => {
    getLocationsWithCounts.mockRejectedValue(new TypeError("secret internals"));

    const { result } = renderHook(() => useLocations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe("No se pudo completar la operacion. Intentalo de nuevo.");
  });

  it("surfaces the permission error without calling the repository", async () => {
    mocks.permissions.current = [];

    const { result } = renderHook(() => useLocations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canRead).toBe(false);
    expect(result.current.loadError).toMatch(/permisos/);
    expect(getLocationsWithCounts).not.toHaveBeenCalled();
  });

  it("recovers on retry", async () => {
    getLocationsWithCounts.mockRejectedValueOnce(new BackendRequestError("Sin conexión", 0));
    getLocationsWithCounts.mockResolvedValue([locationEntry("l1", "Pasillo", "branch-north")]);
    const { result } = renderHook(() => useLocations());
    await waitFor(() => expect(result.current.loadError).toBe("Sin conexión"));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.loadError).toBeNull();
    expect(result.current.locations.map((item) => item.name)).toEqual(["Pasillo"]);
  });

  it("asks the repository for the active branch only and shows no other branch's rows", async () => {
    getLocationsWithCounts.mockResolvedValue([
      locationEntry("l1", "Norte-1", "branch-north"),
      locationEntry("l2", "Sur-1", "branch-south"),
    ]);

    const { result } = renderHook(() => useLocations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getLocationsWithCounts).toHaveBeenCalledWith("branch-north");
    expect(result.current.locations.map((item) => item.name)).toEqual(["Norte-1"]);
  });

  it("on a branch change it never shows the previous branch and is loading, not empty, until the new answer", async () => {
    getLocationsWithCounts.mockImplementation(async (branchId: string) => [
      locationEntry(`loc-${branchId}`, `Loc de ${branchId}`, branchId),
    ]);
    const { result, rerender } = renderHook(() => useLocations());
    await waitFor(() => expect(result.current.locations.map((item) => item.name)).toEqual(["Loc de branch-north"]));

    const pending = deferred<unknown[]>();
    getLocationsWithCounts.mockReturnValueOnce(pending.promise);
    mocks.branch.current = { id: "branch-south" };
    rerender();

    expect(result.current.locations).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      pending.resolve([locationEntry("l9", "Sur-9", "branch-south", 7)]);
      await pending.promise;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getLocationsWithCounts).toHaveBeenLastCalledWith("branch-south");
    expect(result.current.locations.map((item) => [item.name, item.productCount])).toEqual([["Sur-9", 7]]);
  });

  it("a slow answer for the previous branch cannot overwrite the current one", async () => {
    const slowNorth = deferred<unknown[]>();
    getLocationsWithCounts.mockReturnValueOnce(slowNorth.promise);
    getLocationsWithCounts.mockResolvedValue([locationEntry("l9", "Sur-9", "branch-south")]);
    const { result, rerender } = renderHook(() => useLocations());
    // La consulta de Norte (lenta) ya esta en vuelo cuando el usuario cambia a Sur.
    await waitFor(() => expect(getLocationsWithCounts).toHaveBeenCalledWith("branch-north"));

    mocks.branch.current = { id: "branch-south" };
    rerender();
    await waitFor(() => expect(result.current.locations.map((item) => item.name)).toEqual(["Sur-9"]));
    await act(async () => {
      slowNorth.resolve([locationEntry("l1", "Norte-1", "branch-north")]);
      await slowNorth.promise;
    });

    expect(result.current.locations.map((item) => item.name)).toEqual(["Sur-9"]);
    expect(result.current.loadError).toBeNull();
  });

  it("in mock mode without an active branch it does not query and does not invent an error", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    mocks.branch.current = undefined;

    const { result } = renderHook(() => useLocations());
    await act(async () => {
      await result.current.reload();
    });

    expect(getLocationsWithCounts).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it("in mock mode it waits for the branch to resolve before reporting an empty list", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    mocks.branch.loading = true;
    mocks.branch.current = undefined;

    const { result } = renderHook(() => useLocations());

    expect(result.current.loading).toBe(true);
  });

  it("refreshes the counts when inventory changes", async () => {
    getLocationsWithCounts.mockResolvedValueOnce([locationEntry("l1", "Pasillo", "branch-north", 1)]);
    getLocationsWithCounts.mockResolvedValueOnce([locationEntry("l1", "Pasillo", "branch-north", 3)]);
    const { result } = renderHook(() => useLocations());
    await waitFor(() => expect(result.current.locations[0]?.productCount).toBe(1));

    await act(async () => {
      mocks.eventHandlers.get("inventory.changed")?.();
    });

    await waitFor(() => expect(result.current.locations[0]?.productCount).toBe(3));
  });
});
