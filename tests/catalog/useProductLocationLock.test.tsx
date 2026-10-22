import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryBalance } from "@/core/entities";
import {
  resolveLocationAssignment,
  useProductLocationLock,
  type ProductLocationAssignment,
} from "@/modules/catalog/hooks/useProductLocationLock";

const mocks = vi.hoisted(() => ({ getProductBalances: vi.fn() }));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({ inventory: { getProductBalances: mocks.getProductBalances } }),
}));

const plain = { stock: true, lot: false, expiration: false, serial: false };
const traced = { stock: true, lot: true, expiration: true, serial: false };

/** Cambio de una ubicacion que la sucursal ya tiene asignada. */
const assigned: ProductLocationAssignment = { status: "ready", locationId: "loc-a" };
/** Asignacion inicial: la sucursal aun no tiene ubicacion para el producto. */
const unassigned: ProductLocationAssignment = { status: "ready", locationId: null };

function balance(quantity: number, reservedQuantity = 0, locationId?: string): InventoryBalance {
  return {
    id: `balance-${quantity}-${reservedQuantity}-${locationId ?? "null"}`,
    tenantId: "tenant-1",
    branchId: "branch-1",
    productId: "product-1",
    locationId,
    quantity,
    reservedQuantity,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function lock(overrides: Partial<Parameters<typeof useProductLocationLock>[0]> = {}) {
  return renderHook(() =>
    useProductLocationLock({
      enabled: true,
      tenantId: "tenant-1",
      productId: "product-1",
      branchId: "branch-1",
      tracking: plain,
      canReadStock: true,
      assignment: assigned,
      ...overrides,
    }),
  );
}

beforeEach(() => {
  mocks.getProductBalances.mockReset();
});

describe("useProductLocationLock changing an existing assignment", () => {
  it("stays locked while the physical balances are loading", () => {
    mocks.getProductBalances.mockReturnValue(new Promise(() => undefined));

    expect(lock().result.current).toEqual({ status: "loading" });
  });

  it("unlocks a product with zero physical stock, no reservations and no blockers", async () => {
    mocks.getProductBalances.mockResolvedValue([balance(0), balance(0, 0, "a")]);

    const { result } = lock();

    await waitFor(() => expect(result.current).toEqual({ status: "unlocked" }));
    expect(mocks.getProductBalances).toHaveBeenCalledWith("product-1", "branch-1", "tenant-1", {
      fresh: true,
    });
  });

  it("locks a product that has physical stock", async () => {
    mocks.getProductBalances.mockResolvedValue([balance(5, 0, "a")]);

    const { result } = lock();

    await waitFor(() => expect(result.current).toEqual({ status: "locked", reason: "stock" }));
  });

  it("does not confuse zero availability with zero physical stock: fully reserved stock stays locked", async () => {
    mocks.getProductBalances.mockResolvedValue([balance(4, 4, "a")]);

    const { result } = lock();

    await waitFor(() => expect(result.current).toEqual({ status: "locked", reason: "stock" }));
  });

  it("locks when only reservations remain", async () => {
    mocks.getProductBalances.mockResolvedValue([balance(0, 2, "a")]);

    const { result } = lock();

    await waitFor(() => expect(result.current).toEqual({ status: "locked", reason: "stock" }));
  });

  it("locks safely when the balances cannot be read", async () => {
    mocks.getProductBalances.mockRejectedValue(new Error("fallo de red"));

    const { result } = lock();

    await waitFor(() =>
      expect(result.current).toEqual({ status: "locked", reason: "unverified" }),
    );
  });

  it.each([
    ["lot", { ...plain, lot: true }],
    ["serial", { ...plain, serial: true }],
    ["expiration", { ...plain, expiration: true }],
  ])(
    "keeps a %s tracked product with an assigned location locked because lots and serials cannot be verified",
    (_label, tracking) => {
      const { result } = lock({ tracking });

      expect(result.current).toEqual({ status: "locked", reason: "traceability" });
      expect(mocks.getProductBalances).not.toHaveBeenCalled();
    },
  );
});

describe("useProductLocationLock initial assignment in a branch without a location", () => {
  it("unlocks a traceable product when THIS branch has no stock, whatever other branches hold", async () => {
    // Existencias en Sur no aparecen: el repositorio ya devuelve solo los balances de la sucursal.
    mocks.getProductBalances.mockResolvedValue([]);

    const { result } = lock({ tracking: traced, assignment: unassigned, branchId: "branch-north" });

    await waitFor(() => expect(result.current).toEqual({ status: "unlocked" }));
    expect(mocks.getProductBalances).toHaveBeenCalledWith(
      "product-1",
      "branch-north",
      "tenant-1",
      { fresh: true },
    );
  });

  it("unlocks a traceable product whose branch balances are all zero", async () => {
    mocks.getProductBalances.mockResolvedValue([balance(0), balance(0, 0, "a")]);

    const { result } = lock({ tracking: traced, assignment: unassigned });

    await waitFor(() => expect(result.current).toEqual({ status: "unlocked" }));
  });

  it.each([
    ["legacy stock without location", [balance(3)]],
    ["stock in a location", [balance(3, 0, "a")]],
    ["reservations only", [balance(0, 2)]],
  ])("keeps a traceable product locked in this branch with %s", async (_label, balances) => {
    mocks.getProductBalances.mockResolvedValue(balances);

    const { result } = lock({ tracking: traced, assignment: unassigned });

    await waitFor(() => expect(result.current).toEqual({ status: "locked", reason: "stock" }));
  });

  it("locks safely when the branch balances cannot be verified, even for a traceable product", async () => {
    mocks.getProductBalances.mockRejectedValue(new Error("fallo de red"));

    const { result } = lock({ tracking: traced, assignment: unassigned });

    await waitFor(() =>
      expect(result.current).toEqual({ status: "locked", reason: "unverified" }),
    );
  });

  it("does not unlock an initial assignment before the balances are verified", () => {
    mocks.getProductBalances.mockReturnValue(new Promise(() => undefined));

    expect(lock({ tracking: traced, assignment: unassigned }).result.current).toEqual({
      status: "loading",
    });
  });
});

describe("useProductLocationLock when the branch settings are not known yet", () => {
  it("waits for the branch settings before deciding and reads nothing", () => {
    const { result } = lock({ tracking: traced, assignment: { status: "loading" } });

    expect(result.current).toEqual({ status: "loading" });
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it("locks as unverified when the branch settings could not be read", () => {
    const { result } = lock({ tracking: traced, assignment: { status: "error" } });

    expect(result.current).toEqual({ status: "locked", reason: "unverified" });
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });
});

describe("useProductLocationLock permissions and context", () => {
  it("locks with a permission reason, without reading, when the user cannot verify the stock", () => {
    const { result } = lock({ canReadStock: false, assignment: unassigned, tracking: traced });

    expect(result.current).toEqual({ status: "locked", reason: "permission" });
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it("locks as unverified without reading when the tenant, product or branch is unknown", () => {
    const { result } = lock({ branchId: undefined });

    expect(result.current).toEqual({ status: "locked", reason: "unverified" });
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it("does not lock or read anything when the check is disabled (new products, services, kits)", () => {
    const { result } = lock({ enabled: false, productId: undefined });

    expect(result.current).toEqual({ status: "unlocked" });
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it("scopes the check to the active branch only", async () => {
    mocks.getProductBalances.mockResolvedValue([]);

    const { result } = lock({ branchId: "branch-9" });

    await waitFor(() => expect(result.current).toEqual({ status: "unlocked" }));
    expect(mocks.getProductBalances).toHaveBeenCalledWith(
      "product-1",
      "branch-9",
      "tenant-1",
      expect.anything(),
    );
  });

  it("never reuses the verdict of a previous branch when the branch changes", async () => {
    // Sur no tiene existencias; Norte aun no responde. (useRepositories devuelve un objeto nuevo en
    // cada render, asi que el efecto puede repetirse: la respuesta depende de la sucursal.)
    mocks.getProductBalances.mockImplementation((_product: string, branch: string) =>
      branch === "branch-south" ? Promise.resolve([]) : new Promise(() => undefined),
    );
    const { result, rerender } = renderHook(
      ({ branchId }: { branchId: string }) =>
        useProductLocationLock({
          enabled: true,
          tenantId: "tenant-1",
          productId: "product-1",
          branchId,
          tracking: traced,
          canReadStock: true,
          assignment: unassigned,
        }),
      { initialProps: { branchId: "branch-south" } },
    );
    await waitFor(() => expect(result.current).toEqual({ status: "unlocked" }));

    rerender({ branchId: "branch-north" });

    expect(result.current).toEqual({ status: "loading" });
  });
});

describe("resolveLocationAssignment", () => {
  it("is ready without location when the loaded settings have no default location", () => {
    expect(resolveLocationAssignment({ defaultLocationId: "" }, "loaded")).toEqual({
      status: "ready",
      locationId: null,
    });
    expect(resolveLocationAssignment({}, "loaded")).toEqual({ status: "ready", locationId: null });
  });

  it("is ready with the branch's location when the loaded settings have one", () => {
    expect(resolveLocationAssignment({ defaultLocationId: "loc-a" }, "loaded")).toEqual({
      status: "ready",
      locationId: "loc-a",
    });
  });

  it("waits while the settings are not loaded yet", () => {
    expect(resolveLocationAssignment(undefined, "notLoaded")).toEqual({ status: "loading" });
    expect(resolveLocationAssignment(undefined, "loading")).toEqual({ status: "loading" });
  });

  it("reports an error, and never a guessed location, when the settings could not be read", () => {
    expect(resolveLocationAssignment(undefined, "error")).toEqual({ status: "error" });
  });

  it("keeps trusting a baseline already loaded even if a later reload fails", () => {
    expect(resolveLocationAssignment({ defaultLocationId: "loc-a" }, "error")).toEqual({
      status: "ready",
      locationId: "loc-a",
    });
  });
});
