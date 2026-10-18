import { describe, expect, it } from "vitest";
import {
  InventoryMovementType,
  InventoryReservationStatus,
  LocationStatus,
  SerialStatus,
} from "@/core/enums";
import type {
  RegisterInventoryMovementInput,
  UpsertProductInventorySettingsInput,
} from "@/core/repositories";
import {
  addBalance,
  createInventoryScenario,
  LOCATION_A_ID,
  LOCATION_B_ID,
  LOT_PRODUCT_ID,
  ORDER_ID,
  ORDER_ITEM_ID,
  OTHER_BRANCH_ID,
  OTHER_TENANT_ID,
  PLAIN_PRODUCT_ID,
  recordInventoryEvents,
  SERIAL_PRODUCT_ID,
  UNASSIGNED_PRODUCT_ID,
} from "./mockInventoryFixtures";

const TRACEABILITY_ERROR = "Traceable stock must be mutated through a traceability-aware workflow.";

function movementInput(
  scenario: ReturnType<typeof createInventoryScenario>,
  overrides: Partial<RegisterInventoryMovementInput> = {},
): RegisterInventoryMovementInput {
  return {
    tenantId: scenario.tenantId,
    branchId: scenario.branchId,
    productId: PLAIN_PRODUCT_ID,
    type: InventoryMovementType.in,
    reason: "Entrada de prueba",
    quantity: 5,
    toLocationId: LOCATION_A_ID,
    performedByUserId: "user-test",
    ...overrides,
  };
}

function productBalances(scenario: ReturnType<typeof createInventoryScenario>, productId: string) {
  return scenario.store
    .getSnapshot()
    .inventoryBalances.filter((balance) => balance.productId === productId);
}

describe("MockInventoryRepository movements", () => {
  it("creates the balance of a location that did not exist when receiving stock", async () => {
    const scenario = createInventoryScenario();

    const movement = await scenario.repository.registerMovement(movementInput(scenario));

    expect(movement).toMatchObject({
      productId: PLAIN_PRODUCT_ID,
      type: InventoryMovementType.in,
      quantity: 5,
      quantityBefore: 0,
      quantityAfter: 5,
      toLocationId: LOCATION_A_ID,
    });
    expect(movement.id).toMatch(/^movement-/);
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)).toEqual([
      expect.objectContaining({
        tenantId: scenario.tenantId,
        branchId: scenario.branchId,
        locationId: LOCATION_A_ID,
        quantity: 5,
        reservedQuantity: 0,
      }),
    ]);
  });

  it("subtracts exits from the origin location keeping the before and after quantities", async () => {
    const scenario = createInventoryScenario();
    await scenario.repository.registerMovement(movementInput(scenario));

    const exit = await scenario.repository.registerMovement(
      movementInput(scenario, {
        type: InventoryMovementType.out,
        quantity: 2,
        toLocationId: undefined,
        fromLocationId: LOCATION_A_ID,
      }),
    );

    expect(exit).toMatchObject({ quantityBefore: 5, quantityAfter: 3 });
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0].quantity).toBe(3);
  });

  it("applies adjustments as their own movement type over the same balance", async () => {
    const scenario = createInventoryScenario();
    await scenario.repository.registerMovement(movementInput(scenario));

    const adjustment = await scenario.repository.adjustStock({
      ...movementInput(scenario, { quantity: 4 }),
    });

    expect(adjustment.type).toBe(InventoryMovementType.adjustment);
    expect(adjustment).toMatchObject({ quantityBefore: 5, quantityAfter: 9 });
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0].quantity).toBe(9);
  });

  it("never creates a legacy NULL balance automatically for an assigned product", async () => {
    const scenario = createInventoryScenario();
    await scenario.repository.registerMovement(movementInput(scenario));

    await expect(
      scenario.repository.registerMovement(
        movementInput(scenario, { quantity: 2, toLocationId: undefined }),
      ),
    ).rejects.toMatchObject({ code: "INVENTORY_LOCATION_REQUIRED" });

    const balances = productBalances(scenario, PLAIN_PRODUCT_ID);
    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({ locationId: LOCATION_A_ID, quantity: 5 });
  });

  it("rejects movements outside the assigned operational location without side effects", async () => {
    const scenario = createInventoryScenario();
    const events = recordInventoryEvents(scenario.eventBus);

    await expect(
      scenario.repository.registerMovement(movementInput(scenario, { toLocationId: LOCATION_B_ID })),
    ).rejects.toMatchObject({ code: "INVENTORY_LOCATION_MISMATCH" });

    expect(productBalances(scenario, PLAIN_PRODUCT_ID)).toEqual([]);
    expect(events).toEqual([]);
  });

  it("does not let a product without assignment operate stock", async () => {
    const scenario = createInventoryScenario();

    await expect(
      scenario.repository.registerMovement(
        movementInput(scenario, { productId: UNASSIGNED_PRODUCT_ID }),
      ),
    ).rejects.toMatchObject({ code: "INVENTORY_LOCATION_NOT_ASSIGNED" });
    await expect(
      scenario.repository.registerMovement(
        movementInput(scenario, { productId: UNASSIGNED_PRODUCT_ID, toLocationId: undefined }),
      ),
    ).rejects.toMatchObject({ code: "INVENTORY_LOCATION_NOT_ASSIGNED" });

    expect(productBalances(scenario, UNASSIGNED_PRODUCT_ID)).toEqual([]);
  });

  it("only operates an existing legacy NULL balance of a product without assignment", async () => {
    const scenario = createInventoryScenario();
    addBalance(scenario.store, {
      id: "balance-legacy",
      tenantId: scenario.tenantId,
      branchId: scenario.branchId,
      productId: UNASSIGNED_PRODUCT_ID,
      quantity: 4,
    });

    const exit = await scenario.repository.registerMovement(
      movementInput(scenario, {
        productId: UNASSIGNED_PRODUCT_ID,
        type: InventoryMovementType.out,
        quantity: 1,
        toLocationId: undefined,
      }),
    );

    expect(exit).toMatchObject({ quantityBefore: 4, quantityAfter: 3 });
    expect(productBalances(scenario, UNASSIGNED_PRODUCT_ID)).toHaveLength(1);
  });

  it("rejects an inactive assigned location", async () => {
    const scenario = createInventoryScenario();
    scenario.store.mutate((database) => {
      const location = database.storageLocations.find((item) => item.id === LOCATION_A_ID);
      if (location) location.status = LocationStatus.inactive;
    });

    await expect(scenario.repository.registerMovement(movementInput(scenario))).rejects.toMatchObject({
      code: "INVENTORY_ASSIGNED_LOCATION_INACTIVE",
    });
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)).toEqual([]);
  });

  it("only appends movements and leaves the previous history untouched", async () => {
    const scenario = createInventoryScenario();
    await scenario.repository.registerMovement(movementInput(scenario));
    const before = scenario.store.getSnapshot().inventoryMovements;

    await scenario.repository.registerMovement(movementInput(scenario, { quantity: 1 }));
    await scenario.repository.registerMovement(
      movementInput(scenario, { type: InventoryMovementType.out, quantity: 1 }),
    );

    const after = scenario.store.getSnapshot().inventoryMovements;
    expect(after).toHaveLength(before.length + 2);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("announces the movement and the stock change once each, in that order", async () => {
    const scenario = createInventoryScenario();
    const events = recordInventoryEvents(scenario.eventBus);

    const movement = await scenario.repository.registerMovement(movementInput(scenario));

    expect(events).toEqual([
      {
        name: "inventory.changed",
        payload: {
          entityId: movement.id,
          tenantId: scenario.tenantId,
          branchId: scenario.branchId,
          productId: PLAIN_PRODUCT_ID,
          action: "created",
        },
      },
      {
        name: "stock.changed",
        payload: {
          tenantId: scenario.tenantId,
          branchId: scenario.branchId,
          productId: PLAIN_PRODUCT_ID,
          action: "updated",
        },
      },
    ]);
  });

  it.each([
    ["lot", LOT_PRODUCT_ID],
    ["serial", SERIAL_PRODUCT_ID],
  ])("rejects direct mutations of products tracked by %s", async (_label, productId) => {
    const scenario = createInventoryScenario();
    const events = recordInventoryEvents(scenario.eventBus);
    const before = scenario.store.getSnapshot();

    await expect(
      scenario.repository.registerMovement(movementInput(scenario, { productId })),
    ).rejects.toThrow(TRACEABILITY_ERROR);
    await expect(
      scenario.repository.adjustStock({
        ...movementInput(scenario, { productId }),
      }),
    ).rejects.toThrow(TRACEABILITY_ERROR);

    const after = scenario.store.getSnapshot();
    expect(after.inventoryMovements).toEqual(before.inventoryMovements);
    expect(after.inventoryBalances).toEqual(before.inventoryBalances);
    expect(events).toEqual([]);
  });
});

describe("MockInventoryRepository reservations", () => {
  function reserveInput(scenario: ReturnType<typeof createInventoryScenario>, quantity = 3) {
    return {
      tenantId: scenario.tenantId,
      branchId: scenario.branchId,
      orderId: ORDER_ID,
      orderItemId: ORDER_ITEM_ID,
      productId: PLAIN_PRODUCT_ID,
      quantity,
    };
  }

  function withStock(quantity = 10) {
    const scenario = createInventoryScenario();
    addBalance(scenario.store, {
      id: "balance-a",
      tenantId: scenario.tenantId,
      branchId: scenario.branchId,
      productId: PLAIN_PRODUCT_ID,
      locationId: LOCATION_A_ID,
      quantity,
    });
    return scenario;
  }

  it("reserves the requested quantity on the balance and announces the stock change", async () => {
    const scenario = withStock();
    const events = recordInventoryEvents(scenario.eventBus);

    const reservation = await scenario.repository.reserveForOrderItem(reserveInput(scenario));

    expect(reservation.status).toBe(InventoryReservationStatus.active);
    expect(reservation.allocations).toEqual([
      expect.objectContaining({ balanceId: "balance-a", reservedQuantity: 3, consumedQuantity: 0 }),
    ]);
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0].reservedQuantity).toBe(3);
    expect(events).toEqual([
      {
        name: "stock.changed",
        payload: {
          entityId: reservation.id,
          tenantId: scenario.tenantId,
          branchId: scenario.branchId,
          productId: PLAIN_PRODUCT_ID,
          action: "updated",
          metadata: { entity: "InventoryReservation", status: "active" },
        },
      },
    ]);
  });

  it("is idempotent: repeating the same reservation does not reserve or announce again", async () => {
    const scenario = withStock();
    const events = recordInventoryEvents(scenario.eventBus);
    const first = await scenario.repository.reserveForOrderItem(reserveInput(scenario));

    const second = await scenario.repository.reserveForOrderItem(reserveInput(scenario));

    expect(second.id).toBe(first.id);
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0].reservedQuantity).toBe(3);
    expect(events).toHaveLength(1);
  });

  it("rejects repeating the order item with a different quantity", async () => {
    const scenario = withStock();
    await scenario.repository.reserveForOrderItem(reserveInput(scenario));

    await expect(
      scenario.repository.reserveForOrderItem(reserveInput(scenario, 2)),
    ).rejects.toThrow(`Inventory reservation conflict for OrderItem: ${ORDER_ITEM_ID}`);
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0].reservedQuantity).toBe(3);
  });

  it("does not reserve when the available stock is insufficient", async () => {
    const scenario = withStock(2);
    const events = recordInventoryEvents(scenario.eventBus);

    await expect(scenario.repository.reserveForOrderItem(reserveInput(scenario))).rejects.toThrow(
      "Stock disponible insuficiente",
    );

    expect(await scenario.repository.getReservationByOrderItem(scenario.tenantId, ORDER_ITEM_ID)).toBeNull();
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0].reservedQuantity).toBe(0);
    expect(events).toEqual([]);
  });

  it("validates the quantity against the order item and rejects non positive values", async () => {
    const scenario = withStock();

    await expect(
      scenario.repository.reserveForOrderItem(reserveInput(scenario, 4)),
    ).rejects.toThrow(`Reservation quantity exceeds OrderItem quantity: ${ORDER_ITEM_ID}`);
    await expect(
      scenario.repository.reserveForOrderItem(reserveInput(scenario, 0)),
    ).rejects.toThrow("Reservation quantity must be greater than 0");
    await expect(
      scenario.repository.reserveForOrderItem({ ...reserveInput(scenario), orderId: "missing" }),
    ).rejects.toThrow("Order not found for tenant/branch: missing");
  });

  it("keeps the reservation committed when a listener of the stock event fails", async () => {
    const scenario = withStock();
    scenario.eventBus.subscribe("stock.changed", () => {
      throw new Error("listener failure");
    });

    const reservation = await scenario.repository.reserveForOrderItem(reserveInput(scenario));

    expect(reservation.status).toBe(InventoryReservationStatus.active);
    expect(
      await scenario.repository.getReservationByOrderItem(scenario.tenantId, ORDER_ITEM_ID),
    ).toMatchObject({ id: reservation.id });
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0].reservedQuantity).toBe(3);
  });

  it("looks reservations up only inside the tenant", async () => {
    const scenario = withStock();
    const reservation = await scenario.repository.reserveForOrderItem(reserveInput(scenario));

    expect(
      await scenario.repository.getReservationById(scenario.tenantId, reservation.id),
    ).toMatchObject({ id: reservation.id });
    expect(await scenario.repository.getReservationById(OTHER_TENANT_ID, reservation.id)).toBeNull();
    expect(
      await scenario.repository.getReservationByOrderItem(OTHER_TENANT_ID, ORDER_ITEM_ID),
    ).toBeNull();
  });

  it("releases the reserved quantity once and ignores a repeated release", async () => {
    const scenario = withStock();
    const reservation = await scenario.repository.reserveForOrderItem(reserveInput(scenario));
    const events = recordInventoryEvents(scenario.eventBus);
    const input = {
      tenantId: scenario.tenantId,
      branchId: scenario.branchId,
      reservationId: reservation.id,
    };

    const released = await scenario.repository.releaseReservation(input);
    const repeated = await scenario.repository.releaseReservation(input);

    expect(released.status).toBe(InventoryReservationStatus.released);
    expect(repeated.status).toBe(InventoryReservationStatus.released);
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0].reservedQuantity).toBe(0);
    expect(events.filter((event) => event.name === "stock.changed")).toHaveLength(1);
  });

  it("consumes the reservation, creates the exit movement and replays by operation id", async () => {
    const scenario = withStock();
    const reservation = await scenario.repository.reserveForOrderItem(reserveInput(scenario));
    const events = recordInventoryEvents(scenario.eventBus);
    const input = {
      tenantId: scenario.tenantId,
      branchId: scenario.branchId,
      reservationId: reservation.id,
      allocationsConsumed: [{ balanceId: "balance-a", quantity: 3 }],
      operationId: "operation-1",
      performedByUserId: "user-test",
    };

    const consumed = await scenario.repository.consumeReservation(input);

    expect(consumed.idempotent).toBe(false);
    expect(consumed.reservation.status).toBe(InventoryReservationStatus.consumed);
    expect(consumed.inventoryMovements).toEqual([
      expect.objectContaining({
        productId: PLAIN_PRODUCT_ID,
        type: InventoryMovementType.out,
        quantity: 3,
        quantityBefore: 10,
        quantityAfter: 7,
        fromLocationId: LOCATION_A_ID,
      }),
    ]);
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0]).toMatchObject({
      quantity: 7,
      reservedQuantity: 0,
    });
    expect(events.map((event) => event.name)).toEqual(["inventory.changed", "stock.changed"]);

    const replay = await scenario.repository.consumeReservation(input);

    expect(replay.idempotent).toBe(true);
    expect(replay.inventoryMovements.map((movement) => movement.id)).toEqual(
      consumed.inventoryMovements.map((movement) => movement.id),
    );
    expect(productBalances(scenario, PLAIN_PRODUCT_ID)[0].quantity).toBe(7);
    expect(events).toHaveLength(2);
  });

  it("rejects reusing an operation id with a different consumption", async () => {
    const scenario = withStock();
    const reservation = await scenario.repository.reserveForOrderItem(reserveInput(scenario));
    const input = {
      tenantId: scenario.tenantId,
      branchId: scenario.branchId,
      reservationId: reservation.id,
      allocationsConsumed: [{ balanceId: "balance-a", quantity: 1 }],
      operationId: "operation-1",
      performedByUserId: "user-test",
    };
    await scenario.repository.consumeReservation(input);

    await expect(
      scenario.repository.consumeReservation({
        ...input,
        allocationsConsumed: [{ balanceId: "balance-a", quantity: 2 }],
      }),
    ).rejects.toThrow("Inventory reservation operation conflict: operation-1");
  });
});

describe("MockInventoryRepository reads", () => {
  it("returns product balances scoped to tenant, branch and product", async () => {
    const scenario = createInventoryScenario();
    const { store, tenantId, branchId, repository } = scenario;
    addBalance(store, {
      id: "balance-own",
      tenantId,
      branchId,
      productId: PLAIN_PRODUCT_ID,
      locationId: LOCATION_A_ID,
      quantity: 5,
    });
    addBalance(store, {
      id: "balance-other-branch",
      tenantId,
      branchId: OTHER_BRANCH_ID,
      productId: PLAIN_PRODUCT_ID,
      quantity: 7,
    });
    addBalance(store, {
      id: "balance-other-tenant",
      tenantId: OTHER_TENANT_ID,
      branchId,
      productId: PLAIN_PRODUCT_ID,
      quantity: 9,
    });
    addBalance(store, {
      id: "balance-other-product",
      tenantId,
      branchId,
      productId: LOT_PRODUCT_ID,
      quantity: 2,
    });

    const scoped = await repository.getProductBalances(PLAIN_PRODUCT_ID, branchId, tenantId);
    const byProduct = await repository.getBalanceByProduct(PLAIN_PRODUCT_ID);
    const byProductAndBranch = await repository.getBalanceByProduct(PLAIN_PRODUCT_ID, branchId);

    expect(scoped.map((balance) => balance.id)).toEqual(["balance-own"]);
    expect(byProduct.map((balance) => balance.id).sort()).toEqual([
      "balance-other-branch",
      "balance-other-tenant",
      "balance-own",
    ]);
    expect(byProductAndBranch.map((balance) => balance.id).sort()).toEqual([
      "balance-other-tenant",
      "balance-own",
    ]);
  });

  it("filters movements, lots and serial numbers by product", async () => {
    const scenario = createInventoryScenario();
    const { store, tenantId, branchId, repository } = scenario;
    await repository.registerMovement(movementInput(scenario));
    store.mutate((database) => {
      database.stockLots.push({
        id: "lot-test",
        tenantId,
        branchId,
        productId: LOT_PRODUCT_ID,
        locationId: LOCATION_A_ID,
        lotNumber: "L-TEST",
        quantity: 4,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      database.serialNumbers.push({
        id: "serial-test",
        tenantId,
        branchId,
        productId: SERIAL_PRODUCT_ID,
        locationId: LOCATION_A_ID,
        serialNumber: "SN-TEST",
        status: SerialStatus.available,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const movements = await repository.getMovements(PLAIN_PRODUCT_ID);
    expect(movements).toHaveLength(1);
    expect(movements[0].productId).toBe(PLAIN_PRODUCT_ID);
    expect(await repository.getMovements("unknown-product")).toEqual([]);
    expect(await repository.getMovements()).toHaveLength(
      store.getSnapshot().inventoryMovements.length,
    );

    expect((await repository.getLots(LOT_PRODUCT_ID)).map((lot) => lot.id)).toEqual(["lot-test"]);
    expect(await repository.getLots("unknown-product")).toEqual([]);
    expect(await repository.getLots()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "lot-test" })]),
    );
    expect(
      (await repository.getSerialNumbers(SERIAL_PRODUCT_ID)).map((serial) => serial.id),
    ).toEqual(["serial-test"]);
    expect(await repository.getSerialNumbers("unknown-product")).toEqual([]);
  });

  it("filters locations by branch", async () => {
    const { repository, branchId } = createInventoryScenario();

    const branchLocations = await repository.getLocations(branchId);

    expect(branchLocations.map((location) => location.id)).toEqual(
      expect.arrayContaining([LOCATION_A_ID, LOCATION_B_ID]),
    );
    expect(branchLocations.every((location) => location.branchId === branchId)).toBe(true);
    expect(await repository.getLocations(OTHER_BRANCH_ID)).toEqual([]);
    expect((await repository.getLocations()).length).toBeGreaterThanOrEqual(branchLocations.length);
  });
});

describe("MockInventoryRepository locations", () => {
  it("creates a location in the branch and announces it", async () => {
    const { repository, eventBus, tenantId, branchId } = createInventoryScenario();
    const events = recordInventoryEvents(eventBus);

    const created = await repository.createLocation({
      tenantId,
      branchId,
      code: "NEW-1",
      name: "Estante nuevo",
      type: "shelf",
      status: LocationStatus.active,
    });

    expect(created.id).toMatch(/^location-/);
    expect(created.createdAt).toBe(created.updatedAt);
    expect((await repository.getLocations(branchId)).map((item) => item.id)).toContain(created.id);
    expect(events).toEqual([
      {
        name: "inventory.changed",
        payload: {
          entityId: created.id,
          tenantId,
          branchId,
          action: "created",
          metadata: { entity: "StorageLocation" },
        },
      },
    ]);
  });

  it("fails when updating a location that does not exist", async () => {
    const { repository, eventBus } = createInventoryScenario();
    const events = recordInventoryEvents(eventBus);

    await expect(repository.updateLocation("missing", { name: "X" })).rejects.toThrow(
      "StorageLocation not found: missing",
    );
    expect(events).toEqual([]);
  });

  it("announces archiving as an archived action and other edits as updates", async () => {
    const { repository, eventBus } = createInventoryScenario();
    const events = recordInventoryEvents(eventBus);

    await repository.updateLocation(LOCATION_B_ID, { name: "Renombrada" });
    await repository.updateLocation(LOCATION_B_ID, { status: LocationStatus.archived });

    expect(events.map((event) => event.payload.action)).toEqual(["updated", "archived"]);
  });

  it("allows editing an assigned location as long as it stays active", async () => {
    const { repository, assignedLocationId } = createInventoryScenario();

    const updated = await repository.updateLocation(assignedLocationId, { name: "Renombrada" });

    expect(updated.name).toBe("Renombrada");
    expect(updated.status).toBe(LocationStatus.active);
  });
});

describe("MockInventoryRepository settings validation", () => {
  function settingsInput(
    scenario: ReturnType<typeof createInventoryScenario>,
    overrides: Partial<UpsertProductInventorySettingsInput> = {},
  ): UpsertProductInventorySettingsInput {
    return {
      tenantId: scenario.tenantId,
      branchId: scenario.branchId,
      productId: UNASSIGNED_PRODUCT_ID,
      minStock: 1,
      ...overrides,
    };
  }

  it("rejects negative minimum stock and reorder point", async () => {
    const scenario = createInventoryScenario();

    await expect(
      scenario.repository.upsertProductInventorySettings(settingsInput(scenario, { minStock: -1 })),
    ).rejects.toThrow("minStock must be greater than or equal to 0");
    await expect(
      scenario.repository.upsertProductInventorySettings(
        settingsInput(scenario, { reorderPoint: -1 }),
      ),
    ).rejects.toThrow("reorderPoint must be greater than or equal to 0");
  });

  it("rejects unknown products, branches and locations", async () => {
    const scenario = createInventoryScenario();
    const upsert = (overrides: Parameters<typeof settingsInput>[1]) =>
      scenario.repository.upsertProductInventorySettings(settingsInput(scenario, overrides));

    await expect(upsert({ productId: "missing" })).rejects.toThrow("Product not found: missing");
    await expect(upsert({ branchId: "missing" })).rejects.toThrow("Branch not found: missing");
    await expect(upsert({ defaultLocationId: "missing" })).rejects.toThrow(
      "StorageLocation not found: missing",
    );
  });

  it("keeps product, branch and location inside the same tenant and branch", async () => {
    const scenario = createInventoryScenario();
    const { store, branchId, repository } = scenario;
    const snapshot = store.getSnapshot();
    const product = snapshot.products.find((item) => item.id === PLAIN_PRODUCT_ID);
    const location = snapshot.storageLocations.find((item) => item.id === LOCATION_A_ID);
    if (!product || !location) throw new Error("Fixture sin producto o ubicacion.");
    store.mutate((database) => {
      database.products.push({ ...product, id: "product-foreign", tenantId: OTHER_TENANT_ID });
      database.storageLocations.push(
        { ...location, id: "location-foreign-tenant", tenantId: OTHER_TENANT_ID },
        { ...location, id: "location-foreign-branch", branchId: OTHER_BRANCH_ID },
      );
    });

    await expect(
      repository.upsertProductInventorySettings(
        settingsInput(scenario, { tenantId: OTHER_TENANT_ID }),
      ),
    ).rejects.toThrow("tenant must match product tenant");
    await expect(
      repository.upsertProductInventorySettings(
        settingsInput(scenario, { tenantId: OTHER_TENANT_ID, productId: "product-foreign", branchId }),
      ),
    ).rejects.toThrow("tenant must match branch tenant");
    await expect(
      repository.upsertProductInventorySettings(
        settingsInput(scenario, { defaultLocationId: "location-foreign-tenant" }),
      ),
    ).rejects.toThrow("Default location tenant must match");
    await expect(
      repository.upsertProductInventorySettings(
        settingsInput(scenario, { defaultLocationId: "location-foreign-branch" }),
      ),
    ).rejects.toThrow("Default location branch must match");
  });

  it("creates the settings once and updates them afterwards keeping the assigned location", async () => {
    const scenario = createInventoryScenario();
    const events = recordInventoryEvents(scenario.eventBus);

    const created = await scenario.repository.upsertProductInventorySettings(
      settingsInput(scenario, { defaultLocationId: LOCATION_A_ID }),
    );
    const updated = await scenario.repository.upsertProductInventorySettings(
      settingsInput(scenario, { minStock: 6 }),
    );

    expect(created.id).toMatch(/^product-inventory-settings-/);
    expect(created.reorderPoint).toBeUndefined();
    expect(updated).toMatchObject({
      id: created.id,
      minStock: 6,
      defaultLocationId: LOCATION_A_ID,
    });
    expect(events.map((event) => event.payload.action)).toEqual(["created", "updated"]);
    expect(events[0].payload.metadata).toEqual({ entity: "ProductInventorySettings" });
  });
});

describe("MockInventoryRepository API only methods", () => {
  it("rejects server side pages with an explicit message", async () => {
    const { repository, branchId } = createInventoryScenario();

    await expect(repository.getMovementPage({ page: 1, pageSize: 10 })).rejects.toThrow(
      "Server-side inventory movement pages are only available in API mode.",
    );
    await expect(repository.getStockPage({ branchId, page: 1, pageSize: 10 })).rejects.toThrow(
      "Server-side inventory stock pages are only available in API mode.",
    );
    await expect(
      repository.getInventoryAlertPage({ branchId, page: 1, pageSize: 10 }),
    ).rejects.toThrow("Server-side inventory alert pages are only available in API mode.");
  });

  it("rejects batch, kit and other branch reads with an explicit message", async () => {
    const { repository } = createInventoryScenario();

    await expect(repository.getStockBatch()).rejects.toThrow(
      "Batch stock reads are only available in API mode.",
    );
    await expect(repository.getKitAvailability()).rejects.toThrow(
      "Kit availability details are only available in API mode.",
    );
    await expect(repository.getOtherBranchesAvailability()).rejects.toThrow(
      "Other-branch availability is only available in API mode.",
    );
  });
});
