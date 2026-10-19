import { describe, expect, it } from "vitest";
import { InventoryReservationStatus, LocationStatus } from "@/core/enums";
import type {
  LegacyBalanceRegularizationPreview,
  RegularizeLocationBalanceInput,
} from "@/core/repositories";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockInventoryAdjustmentRepository } from "@/infrastructure/mock/repositories/MockInventoryAdjustmentRepository";
import {
  addBalance,
  createInventoryScenario,
  LOCATION_A_ID,
  LOCATION_B_ID,
  LOT_PRODUCT_ID,
  MemoryStorageAdapter,
  OTHER_BRANCH_ID,
  PLAIN_PRODUCT_ID,
  recordInventoryEvents,
  UNASSIGNED_PRODUCT_ID,
} from "./mockInventoryFixtures";

const CODE = "INVENTORY_REGULARIZATION_";

/** Producto sin asignacion con saldo heredado NULL (6, 2 reservadas) y una reserva activa. */
function createLegacyScenario(productId = UNASSIGNED_PRODUCT_ID) {
  const scenario = createInventoryScenario();
  const { store, tenantId, branchId } = scenario;
  addBalance(store, {
    id: "balance-legacy",
    tenantId,
    branchId,
    productId,
    quantity: 6,
    reservedQuantity: 2,
  });
  store.mutate((database) => {
    database.inventoryReservations.push({
      id: "reservation-legacy",
      tenantId,
      branchId,
      orderId: "order-legacy",
      orderItemId: "order-item-legacy",
      productId,
      status: InventoryReservationStatus.active,
      allocations: [
        {
          id: "allocation-legacy",
          balanceId: "balance-legacy",
          reservedQuantity: 2,
          consumedQuantity: 0,
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });
  const adjustments = new MockInventoryAdjustmentRepository(store, scenario.eventBus);
  return { ...scenario, adjustments, productId };
}

type Legacy = ReturnType<typeof createLegacyScenario>;

function previewOf(legacy: Legacy, locationId = LOCATION_A_ID, assign = true) {
  return legacy.adjustments.previewLocationRegularization({
    branchId: legacy.branchId,
    productId: legacy.productId,
    locationId,
    ...(assign ? { assign: true } : {}),
  });
}

function requestFrom(
  legacy: Legacy,
  preview: LegacyBalanceRegularizationPreview,
  overrides: Partial<RegularizeLocationBalanceInput> = {},
): RegularizeLocationBalanceInput {
  return {
    branchId: legacy.branchId,
    productId: legacy.productId,
    locationId: preview.locationId,
    idempotencyKey: "key-1",
    reason: "Regularizacion explicita",
    expectedSourceQuantity: preview.sourceQuantity,
    expectedSourceReservedQuantity: preview.sourceReservedQuantity,
    expectedDestinationQuantity: preview.destinationQuantity,
    snapshotFingerprint: preview.snapshotFingerprint,
    assignDestination: preview.assignmentRequired,
    ...overrides,
  };
}

function balancesOf(legacy: Legacy) {
  return legacy.store
    .getSnapshot()
    .inventoryBalances.filter((item) => item.productId === legacy.productId);
}

describe("mock location regularization: options and preview", () => {
  it("lists the active locations and no assignment for a product without configuration", async () => {
    const legacy = createLegacyScenario();

    const options = await legacy.adjustments.getLocationRegularizationOptions({
      branchId: legacy.branchId,
      productId: legacy.productId,
    });

    expect(options).toMatchObject({ locationsEnabled: true, productId: legacy.productId });
    expect(options.assignedLocationId).toBeUndefined();
    expect(options.assignableLocations.map((item) => item.id)).toEqual(
      expect.arrayContaining([LOCATION_A_ID, LOCATION_B_ID]),
    );
  });

  it("requires the explicit assignment mode when the product has no operational location", async () => {
    const legacy = createLegacyScenario();

    const withoutAssign = await previewOf(legacy, LOCATION_A_ID, false);
    const withAssign = await previewOf(legacy);

    expect(withoutAssign.eligible).toBe(false);
    expect(withoutAssign.blockers.map((item) => item.code)).toContain(`${CODE}DESTINATION_NOT_ASSIGNED`);
    expect(withoutAssign).toMatchObject({ assignmentRequired: true, assignmentAllowed: true });
    expect(withAssign).toMatchObject({
      eligible: true,
      sourceQuantity: 6,
      sourceReservedQuantity: 2,
      resultingQuantity: 6,
      resultingReservedQuantity: 2,
      activeReservations: 1,
    });
    expect(withAssign.snapshotFingerprint).toHaveLength(64);
  });

  it("blocks stock held in a third location and inactive destinations", async () => {
    const legacy = createLegacyScenario();
    addBalance(legacy.store, {
      id: "balance-b",
      tenantId: legacy.tenantId,
      branchId: legacy.branchId,
      productId: legacy.productId,
      locationId: LOCATION_B_ID,
      quantity: 3,
    });
    legacy.store.mutate((database) => {
      const location = database.storageLocations.find((item) => item.id === LOCATION_A_ID);
      if (location) location.status = LocationStatus.inactive;
    });

    const preview = await previewOf(legacy);

    expect(preview.eligible).toBe(false);
    expect(preview.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining([`${CODE}THIRD_LOCATION_STOCK`, `${CODE}DESTINATION_INACTIVE`]),
    );
  });

  it("keeps products with lot or serial blocked in local mode instead of simulating success", async () => {
    const legacy = createLegacyScenario(LOT_PRODUCT_ID);

    const preview = await previewOf(legacy);

    expect(preview.eligible).toBe(false);
    expect(preview.blockers.map((item) => item.code)).toContain(`${CODE}PRODUCT_NOT_ELIGIBLE`);
    await expect(
      legacy.adjustments.regularizeLocationBalance(requestFrom(legacy, preview)),
    ).rejects.toMatchObject({ status: 409, code: `${CODE}PRODUCT_NOT_ELIGIBLE` });
    expect(balancesOf(legacy)).toEqual([
      expect.objectContaining({ id: "balance-legacy", quantity: 6, reservedQuantity: 2 }),
    ]);
  });

  it("reports unknown products and locations of other branches", async () => {
    const legacy = createLegacyScenario();
    legacy.store.mutate((database) => {
      const base = database.storageLocations.find((item) => item.id === LOCATION_A_ID);
      if (base) {
        database.storageLocations.push({ ...base, id: "location-elsewhere", branchId: OTHER_BRANCH_ID });
      }
    });

    await expect(
      legacy.adjustments.previewLocationRegularization({
        branchId: legacy.branchId,
        productId: "missing",
        locationId: LOCATION_A_ID,
      }),
    ).rejects.toMatchObject({ status: 404, code: "PRODUCT_NOT_FOUND" });
    await expect(previewOf(legacy, "location-elsewhere")).rejects.toMatchObject({
      status: 400,
      code: "LOCATION_BRANCH_MISMATCH",
    });
  });
});

describe("mock location regularization: explicit execution", () => {
  it("moves the legacy balance atomically, reassigns the reservation and assigns the destination", async () => {
    const legacy = createLegacyScenario();
    const events = recordInventoryEvents(legacy.eventBus);
    const preview = await previewOf(legacy);

    const result = await legacy.adjustments.regularizeLocationBalance(requestFrom(legacy, preview));

    expect(result).toMatchObject({
      idempotent: false,
      toLocationId: LOCATION_A_ID,
      movedQuantity: 6,
      movedReservedQuantity: 2,
      destinationQuantityBefore: 0,
      destinationQuantityAfter: 6,
      destinationReservedQuantityAfter: 2,
      reservationsReassigned: 1,
      assignmentApplied: true,
    });
    const snapshot = legacy.store.getSnapshot();
    const legacyBalance = balancesOf(legacy).find((item) => !item.locationId);
    const destination = balancesOf(legacy).find((item) => item.locationId === LOCATION_A_ID);
    expect(legacyBalance).toMatchObject({ quantity: 0, reservedQuantity: 0 });
    expect(destination).toMatchObject({ quantity: 6, reservedQuantity: 2 });
    expect(
      snapshot.inventoryReservations.find((item) => item.id === "reservation-legacy")?.allocations[0],
    ).toMatchObject({ balanceId: destination?.id, locationId: LOCATION_A_ID });
    expect(
      snapshot.productInventorySettings.find((item) => item.productId === legacy.productId),
    ).toMatchObject({ defaultLocationId: LOCATION_A_ID });
    expect(snapshot.inventoryMovements.find((item) => item.id === result.movementId)).toMatchObject({
      referenceType: "location-regularization",
      referenceId: result.regularizationId,
      quantity: 6,
    });
    expect(events.map((event) => event.name)).toEqual(["inventory.changed", "stock.changed"]);
  });

  it("is idempotent: the same key and request replays the result without changing anything", async () => {
    const legacy = createLegacyScenario();
    const preview = await previewOf(legacy);
    const request = requestFrom(legacy, preview);
    const first = await legacy.adjustments.regularizeLocationBalance(request);
    const events = recordInventoryEvents(legacy.eventBus);
    const before = legacy.store.getSnapshot();

    const replay = await legacy.adjustments.regularizeLocationBalance(request);

    expect(replay).toMatchObject({ idempotent: true, regularizationId: first.regularizationId });
    expect(events).toEqual([]);
    expect(legacy.store.getSnapshot().inventoryBalances).toEqual(before.inventoryBalances);
    expect(legacy.store.getSnapshot().inventoryMovements).toEqual(before.inventoryMovements);
  });

  it("rejects reusing the key with a different request", async () => {
    const legacy = createLegacyScenario();
    const preview = await previewOf(legacy);
    await legacy.adjustments.regularizeLocationBalance(requestFrom(legacy, preview));

    await expect(
      legacy.adjustments.regularizeLocationBalance(
        requestFrom(legacy, preview, { reason: "Otro motivo" }),
      ),
    ).rejects.toMatchObject({ status: 409, code: `${CODE}KEY_REUSED` });
  });

  it("rejects an obsolete preview without touching any balance", async () => {
    const legacy = createLegacyScenario();
    const preview = await previewOf(legacy);
    legacy.store.mutate((database) => {
      const balance = database.inventoryBalances.find((item) => item.id === "balance-legacy");
      if (balance) balance.quantity += 1;
    });
    const before = legacy.store.getSnapshot();

    await expect(
      legacy.adjustments.regularizeLocationBalance(requestFrom(legacy, preview)),
    ).rejects.toMatchObject({ status: 409, code: `${CODE}STALE_SNAPSHOT` });

    expect(legacy.store.getSnapshot().inventoryBalances).toEqual(before.inventoryBalances);
    expect(legacy.store.getSnapshot().productInventorySettings).toEqual(
      before.productInventorySettings,
    );
  });

  it("rejects a blocked regularization with its code and leaves the store unchanged", async () => {
    const legacy = createLegacyScenario();
    addBalance(legacy.store, {
      id: "balance-b",
      tenantId: legacy.tenantId,
      branchId: legacy.branchId,
      productId: legacy.productId,
      locationId: LOCATION_B_ID,
      quantity: 3,
    });
    const preview = await previewOf(legacy);
    const before = legacy.store.getSnapshot();

    await expect(
      legacy.adjustments.regularizeLocationBalance(requestFrom(legacy, preview)),
    ).rejects.toMatchObject({ status: 409, code: `${CODE}THIRD_LOCATION_STOCK` });

    expect(legacy.store.getSnapshot().inventoryBalances).toEqual(before.inventoryBalances);
    expect(legacy.store.getSnapshot().inventoryMovements).toEqual(before.inventoryMovements);
  });

  it("rejects the initial assignment when the product already has an operational location", async () => {
    const scenario = createInventoryScenario();
    addBalance(scenario.store, {
      id: "balance-legacy-assigned",
      tenantId: scenario.tenantId,
      branchId: scenario.branchId,
      productId: PLAIN_PRODUCT_ID,
      quantity: 4,
    });
    const legacy = {
      ...scenario,
      productId: PLAIN_PRODUCT_ID,
      adjustments: new MockInventoryAdjustmentRepository(scenario.store, scenario.eventBus),
    };
    const preview = await previewOf(legacy, LOCATION_A_ID, false);

    expect(preview).toMatchObject({ eligible: true, assignmentRequired: false });
    await expect(
      legacy.adjustments.regularizeLocationBalance(
        requestFrom(legacy, preview, { assignDestination: true }),
      ),
    ).rejects.toMatchObject({ status: 409, code: `${CODE}ASSIGNMENT_CONFLICT` });
    const executed = await legacy.adjustments.regularizeLocationBalance(
      requestFrom(legacy, preview, { assignDestination: false }),
    );
    expect(executed).toMatchObject({ assignmentApplied: false, movedQuantity: 4 });
  });

  it("never migrates legacy balances when the store is created or hydrated", () => {
    const storage = new MemoryStorageAdapter();
    const first = new MockDatabaseStore(storage);
    first.mutate((database) => {
      const product = database.products[0];
      database.inventoryBalances.push({
        id: "balance-hydration",
        tenantId: product.tenantId,
        branchId: database.branches[0].id,
        productId: product.id,
        quantity: 9,
        reservedQuantity: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const hydrated = new MockDatabaseStore(storage).getSnapshot();

    expect(hydrated.inventoryBalances.find((item) => item.id === "balance-hydration")).toMatchObject({
      quantity: 9,
    });
    expect(hydrated.inventoryLocationRegularizations).toEqual([]);
  });

  it("keeps an invalid persisted assignment as evidence instead of deleting it", () => {
    const storage = new MemoryStorageAdapter();
    const first = new MockDatabaseStore(storage);
    const assigned = first.getSnapshot().productInventorySettings.find((item) => item.defaultLocationId);
    if (!assigned?.defaultLocationId) throw new Error("Fixture sin asignacion.");
    first.mutate((database) => {
      const location = database.storageLocations.find((item) => item.id === assigned.defaultLocationId);
      if (location) location.status = LocationStatus.archived;
    });

    const hydrated = new MockDatabaseStore(storage).getSnapshot();

    expect(
      hydrated.productInventorySettings.find((item) => item.id === assigned.id)?.defaultLocationId,
    ).toBe(assigned.defaultLocationId);
  });
});
