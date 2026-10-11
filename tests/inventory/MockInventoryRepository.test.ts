import { describe, expect, it } from "vitest";
import { LocationStatus } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { MemoryStorageAdapter } from "./mockInventoryFixtures";

function createRepository() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const repository = new MockInventoryRepository(store, new DataEventBus());
  const current = store
    .getSnapshot()
    .productInventorySettings.find((settings) => settings.defaultLocationId);
  if (!current?.defaultLocationId) throw new Error("Fixture sin ubicacion predeterminada.");
  store.mutate((database) => {
    const settings = database.productInventorySettings.find((item) => item.id === current.id);
    if (settings) settings.reorderPoint = 17;
  });
  return { repository, store, current: { ...current, reorderPoint: 17 } };
}

describe("MockInventoryRepository inventory settings", () => {
  it("preserves omitted values and clears only explicit null", async () => {
    const { repository, store, current } = createRepository();
    const balancesBefore = store.getSnapshot().inventoryBalances;

    const preserved = await repository.upsertProductInventorySettings({
      tenantId: current.tenantId,
      productId: current.productId,
      branchId: current.branchId,
      minStock: current.minStock + 1,
    });
    expect(preserved.reorderPoint).toBe(17);
    expect(preserved.defaultLocationId).toBe(current.defaultLocationId);

    const cleared = await repository.upsertProductInventorySettings({
      tenantId: current.tenantId,
      productId: current.productId,
      branchId: current.branchId,
      minStock: current.minStock + 2,
      defaultLocationId: null,
    });
    expect(cleared.reorderPoint).toBe(17);
    expect(cleared.defaultLocationId).toBeUndefined();
    expect(store.getSnapshot().inventoryBalances).toEqual(balancesBefore);
  });

  it("rejects assigning inactive or archived locations", async () => {
    const { repository, store, current } = createRepository();
    const candidateId = "location-settings-unavailable";
    const originalLocation = store
      .getSnapshot()
      .storageLocations.find((location) => location.id === current.defaultLocationId);
    if (!originalLocation) throw new Error("Fixture sin ubicacion.");

    for (const status of [LocationStatus.inactive, LocationStatus.archived]) {
      store.mutate((database) => {
        database.storageLocations = database.storageLocations.filter(
          (location) => location.id !== candidateId,
        );
        database.storageLocations.push({ ...originalLocation, id: candidateId, status });
      });

      await expect(
        repository.upsertProductInventorySettings({
          tenantId: current.tenantId,
          productId: current.productId,
          branchId: current.branchId,
          minStock: current.minStock,
          defaultLocationId: candidateId,
        }),
      ).rejects.toThrow("Default location must be active");
    }
  });
});

describe("MockInventoryRepository assigned locations", () => {
  it.each([LocationStatus.inactive, LocationStatus.archived])(
    "rejects changing an assigned location to %s",
    async (status) => {
      const { repository, current } = createRepository();

      await expect(
        repository.updateLocation(current.defaultLocationId!, { status }),
      ).rejects.toThrow("No se puede archivar ni inactivar");
    },
  );

  it("allows status changes only after every product assignment is cleared", async () => {
    const { repository, store, current } = createRepository();
    const locationId = current.defaultLocationId!;
    // La semilla asigna la misma ubicacion a varios productos: limpiar solo uno no la libera.
    const assignments = store
      .getSnapshot()
      .productInventorySettings.filter((settings) => settings.defaultLocationId === locationId);
    expect(assignments.length).toBeGreaterThan(1);

    await repository.upsertProductInventorySettings({
      tenantId: current.tenantId,
      productId: current.productId,
      branchId: current.branchId,
      minStock: current.minStock,
      defaultLocationId: null,
    });
    await expect(
      repository.updateLocation(locationId, { status: LocationStatus.inactive }),
    ).rejects.toThrow("No se puede archivar ni inactivar");

    for (const settings of assignments.filter((item) => item.productId !== current.productId)) {
      await repository.upsertProductInventorySettings({
        tenantId: settings.tenantId,
        productId: settings.productId,
        branchId: settings.branchId,
        minStock: settings.minStock,
        defaultLocationId: null,
      });
    }

    await expect(
      repository.updateLocation(current.defaultLocationId!, {
        status: LocationStatus.inactive,
      }),
    ).resolves.toMatchObject({ status: LocationStatus.inactive });
  });
});
