import { describe, expect, it, vi } from "vitest";
import { createAssignedLocationResolver } from "@/shared/application/services/assignedLocationResolver";

type Settings = { defaultLocationId?: string | null } | null;

function inventory(settings: Record<string, Settings>) {
  return {
    getProductInventorySettings: vi.fn(async (productId: string) => settings[productId] ?? null),
  };
}

describe("createAssignedLocationResolver", () => {
  it("resolves the default location configured for the product in that branch", async () => {
    const source = inventory({ "product-1": { defaultLocationId: "loc-a" } });
    const resolve = createAssignedLocationResolver(source as never, "branch-1");

    await expect(resolve("product-1")).resolves.toBe("loc-a");
    expect(source.getProductInventorySettings).toHaveBeenCalledWith("product-1", "branch-1");
  });

  it("returns null instead of guessing when there is no assignment", async () => {
    const source = inventory({
      "product-no-settings": null,
      "product-null": { defaultLocationId: null },
      "product-missing": {},
    });
    const resolve = createAssignedLocationResolver(source as never, "branch-1");

    await expect(resolve("product-no-settings")).resolves.toBeNull();
    await expect(resolve("product-null")).resolves.toBeNull();
    await expect(resolve("product-missing")).resolves.toBeNull();
  });

  it("asks once per product and shares the pending request between callers", async () => {
    const source = inventory({ "product-1": { defaultLocationId: "loc-a" } });
    const resolve = createAssignedLocationResolver(source as never, "branch-1");

    const [first, second] = await Promise.all([resolve("product-1"), resolve("product-1")]);
    const third = await resolve("product-1");

    expect([first, second, third]).toEqual(["loc-a", "loc-a", "loc-a"]);
    expect(source.getProductInventorySettings).toHaveBeenCalledTimes(1);
  });

  it("keeps products independent from each other", async () => {
    const source = inventory({
      "product-1": { defaultLocationId: "loc-a" },
      "product-2": { defaultLocationId: "loc-b" },
    });
    const resolve = createAssignedLocationResolver(source as never, "branch-1");

    await expect(resolve("product-1")).resolves.toBe("loc-a");
    await expect(resolve("product-2")).resolves.toBe("loc-b");
    expect(source.getProductInventorySettings).toHaveBeenCalledTimes(2);
  });

  it("does not share the cache between resolvers of different branches", async () => {
    const source = inventory({ "product-1": { defaultLocationId: "loc-a" } });
    const first = createAssignedLocationResolver(source as never, "branch-1");
    const second = createAssignedLocationResolver(source as never, "branch-2");

    await first("product-1");
    await second("product-1");

    expect(source.getProductInventorySettings).toHaveBeenNthCalledWith(1, "product-1", "branch-1");
    expect(source.getProductInventorySettings).toHaveBeenNthCalledWith(2, "product-1", "branch-2");
  });
});
