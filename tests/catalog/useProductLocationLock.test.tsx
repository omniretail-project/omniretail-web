import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryBalance } from "@/core/entities";
import { useProductLocationLock } from "@/modules/catalog/hooks/useProductLocationLock";

const mocks = vi.hoisted(() => ({ getProductBalances: vi.fn() }));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({ inventory: { getProductBalances: mocks.getProductBalances } }),
}));

const plain = { stock: true, lot: false, expiration: false, serial: false };

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
      ...overrides,
    }),
  );
}

beforeEach(() => {
  mocks.getProductBalances.mockReset();
});

describe("useProductLocationLock", () => {
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

  it("locks without reading when the user cannot verify the stock", () => {
    const { result } = lock({ canReadStock: false });

    expect(result.current).toEqual({ status: "locked", reason: "unverified" });
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it.each([
    ["lot", { ...plain, lot: true }],
    ["serial", { ...plain, serial: true }],
    ["expiration", { ...plain, expiration: true }],
  ])("keeps a %s tracked product locked because lots and serials cannot be verified", (_label, tracking) => {
    const { result } = lock({ tracking });

    expect(result.current).toEqual({ status: "locked", reason: "traceability" });
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
});
