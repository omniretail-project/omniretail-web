import assert from "node:assert/strict";
import { PickingIncidentType } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ApiPickingRepository } from "@/infrastructure/api/repositories/ApiPickingRepository";
import { parseApiPickingAction } from "@/infrastructure/api/repositories/pickingApi.schema";
import { withApiLogisticsPickingRead } from "@/infrastructure/api/withApiLogisticsPickingRead";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  buildPickingPhysicalSelection,
  buildPickingSerialReplacement,
  getPickingLineUpdateAvailability,
  getPickingLocationLots,
  getPickingLocationSerials,
  normalizePickingQuantity,
} from "@/modules/logistics/application/pickingPhysicalSelection";
import type { PickingDetailLineDto } from "@/modules/logistics/application/dto/PickingReadModelDto";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";
import {
  createPickingUpdateFingerprint,
  getOrCreatePickingOperationId,
  isCurrentPickingRequest,
} from "@/modules/logistics/hooks/pickingRequestIdentity";
import { validatePickingIncident, validatePickingLineUpdate } from "@/modules/logistics/validation/picking.validation";

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = {
  branch: id(1), picking: id(2), item: id(3), order: id(4), user: id(5),
  source: id(6), product: id(7), location: id(8), lotA: id(9), lotB: id(10),
  balance: id(11), serialA: id(12), serialB: id(13), incident: id(14), release: id(15),
};

const action = {
  pickingOrderId: ids.picking,
  orderId: ids.order,
  status: "assigned",
  assignedUserId: ids.user,
  orderStatus: "preparing",
  updatedAt: "2026-10-07T14:00:00Z",
  idempotent: false,
  sourceType: "order",
  sourceId: ids.source,
  sourceReference: "ORD-1",
};

const lineResponse = {
  pickingLineId: ids.item,
  orderItemId: ids.source,
  productId: ids.product,
  sku: "TRACE-1",
  name: "Producto no trazable",
  requiredQuantity: 3.75,
  pickedQuantity: 3.75,
  remainingQuantity: 0,
  status: "completed",
  location: { id: ids.location, code: "A-01", name: "Pasillo A" },
  lot: null,
  serialNumbers: [],
  availableLocations: [{ id: ids.location, code: "A-01", name: "Pasillo A", ownReservedQuantity: 3.75, usableQuantity: 3.75 }],
  availableLots: [],
  availableSerialNumbers: [],
  tracking: { stock: true, lot: false, expiration: false, serial: false },
  inventory: {
    tenantId: id(20), branchId: ids.branch, pickingOrderId: ids.picking, orderId: ids.order,
    productId: ids.product, physicalQuantity: 10, ownReservedQuantity: 3.75,
    otherReservedQuantity: 1, freeQuantity: 5.25, usableQuantity: 9,
    locations: [{
      balanceId: ids.balance, locationId: ids.location, locationCode: "A-01", locationName: "Pasillo A",
      physicalQuantity: 10, ownReservedQuantity: 3.75, otherReservedQuantity: 1,
      freeQuantity: 5.25, usableQuantity: 9,
      lots: [],
      serialNumbers: [],
    }],
  },
  sourceLineId: ids.source,
  trackingSelections: [],
};

const incident = {
  id: ids.incident, pickingOrderId: ids.picking, pickingLineId: ids.item,
  type: "quantity_difference", quantityAffected: 0.25, comment: "Diferencia",
  status: "open", createdBy: ids.user, createdAt: "2026-10-07T14:00:00Z",
  resolvedBy: null, resolvedAt: null,
};
const release = {
  id: ids.release, pickingOrderId: ids.picking, actorUserId: ids.user,
  reason: "Cambio de turno", releasedAt: "2026-10-07T14:00:00Z",
};

async function main() {
  await verifyRoutesBodiesAndErrors();
  verifyPhysicalSelections();
  verifyBackendTraceabilityDegradation();
  verifyStaleResponseGuard();
  verifyCanonicalOperationFingerprint();
  const transferAction = parseApiPickingAction({
    ...action,
    orderId: null,
    orderStatus: null,
    sourceType: "transfer",
    sourceId: id(30),
    sourceReference: "TR-1",
  });
  assert.equal(transferAction.sourceType, "transfer");
  assert.equal(transferAction.orderId, null);
  await verifyApplicationIsolationAndReadBack();
  const wrapped = withApiLogisticsPickingRead({} as RepositoryRegistry);
  assert.equal(wrapped.pickingCommandsEnabled, true);
  assert.equal(wrapped.pickingRead, wrapped.pickingCommands);
  console.log("API Logistics Picking commands, physical selection and isolation: PASS");
}

async function verifyApplicationIsolationAndReadBack() {
  let mockCalls = 0;
  let commandCalls = 0;
  let detailReads = 0;
  const operationIds: string[] = [];
  const forbiddenMock = new Proxy({}, {
    get() {
      return () => {
        mockCalls += 1;
        throw new Error("Mock mutation invoked");
      };
    },
  });
  const detail = {
    pickingOrderId: ids.picking, orderId: ids.order, orderReference: "ORD-1",
    customerName: "Cliente", storePickupContact: null, deliveryMethod: "home_delivery",
    branchId: ids.branch, status: "in_progress", priority: "normal", assignedUserId: ids.user,
    progress: { requiredQuantity: 3.75, pickedQuantity: 3.75, remainingQuantity: 0, percentage: 100 },
    startedAt: "2026-10-07T13:00:00Z", completedAt: null,
    createdAt: "2026-10-07T12:00:00Z", updatedAt: "2026-10-07T14:00:00Z",
    sourceType: "order", sourceId: ids.order, sourceReference: "ORD-1",
    lines: [lineResponse], incidents: [incident], releases: [release],
  };
  const commandRepository = {
    assign: async () => { commandCalls += 1; return action; },
    release: async () => { commandCalls += 1; return release; },
    updateItem: async (_scope: unknown, _pickingId: string, _itemId: string, command: { operationId: string }) => {
      commandCalls += 1;
      operationIds.push(command.operationId);
      return lineResponse;
    },
    createIncident: async () => { commandCalls += 1; return incident; },
    resolveIncident: async () => { commandCalls += 1; return { ...incident, status: "resolved", resolvedBy: ids.user, resolvedAt: "2026-10-07T15:00:00Z" }; },
    complete: async () => { commandCalls += 1; return { ...action, status: "completed", orderStatus: "packing" }; },
  };
  const repositories = {
    auth: {
      getCurrentSessionId: async () => "session",
      getSession: async () => ({ id: "session", userId: ids.user, createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", rememberMe: false }),
    },
    users: { getById: async () => ({ id: ids.user, tenantId: id(20), name: "Picker", email: "p@example.com", type: "employee", status: "active", roleId: id(21), allowedBranchIds: [ids.branch], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }) },
    roles: { getByIdScoped: async () => ({ id: id(21), tenantId: id(20), name: "Picker", isSystem: false, permissions: ["logistics.picking.read", "logistics.picking.start", "logistics.picking.complete"], branchScope: "assigned", status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }) },
    branches: { getById: async () => ({ id: ids.branch, tenantId: id(20), code: "MAIN", name: "Principal", type: "store", status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }) },
    pickingRead: { getDetail: async () => {
      detailReads += 1;
      if (detailReads === 1) throw new Error("Read-back temporal");
      return detail;
    }, getQueue: async () => [] },
    pickingCommands: commandRepository,
    pickingCommandsEnabled: true,
    picking: forbiddenMock,
    customers: forbiddenMock,
    orders: forbiddenMock,
    products: forbiddenMock,
    inventory: forbiddenMock,
    inventoryTransfers: forbiddenMock,
  } as unknown as RepositoryRegistry;
  const service = new PickingApplicationService(repositories);
  await service.assign(ids.branch, ids.picking);
  await service.release(ids.branch, ids.picking, "Cambio");
  const pendingOperationIds = new Map<string, string>();
  const generatedIds = ["operation-retry", "operation-different"];
  const createOperationId = () => generatedIds.shift()!;
  const fingerprint = createPickingUpdateFingerprint({
    pickingOrderId: ids.picking,
    pickingLineId: ids.item,
    targetQuantity: 3.75,
    locationId: null,
    trackingSelections: [],
  });
  const operationId = getOrCreatePickingOperationId(
    pendingOperationIds,
    fingerprint,
    createOperationId,
  );
  const updateCommand = {
    pickingOrderId: ids.picking, pickingLineId: ids.item, pickedQuantity: 3.75,
    operationId, trackingSelections: [],
  };
  await assert.rejects(service.updateLine(ids.branch, updateCommand), /Read-back temporal/);
  const retryOperationId = getOrCreatePickingOperationId(
    pendingOperationIds,
    fingerprint,
    createOperationId,
  );
  await service.updateLine(ids.branch, { ...updateCommand, operationId: retryOperationId });
  assert.deepEqual(operationIds, ["operation-retry", "operation-retry"]);
  const differentOperationId = getOrCreatePickingOperationId(
    pendingOperationIds,
    createPickingUpdateFingerprint({
      pickingOrderId: ids.picking,
      pickingLineId: ids.item,
      targetQuantity: 3.5,
      locationId: null,
      trackingSelections: [],
    }),
    createOperationId,
  );
  assert.notEqual(differentOperationId, operationId);
  await service.registerIncident(ids.branch, { pickingOrderId: ids.picking, type: PickingIncidentType.damaged, comment: "Daño" });
  await service.resolveIncident(ids.branch, ids.picking, ids.incident);
  await service.complete(ids.branch, ids.picking);
  assert.equal(commandCalls, 7);
  assert.equal(detailReads, 2);
  assert.equal(mockCalls, 0);
}

async function verifyRoutesBodiesAndErrors() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
      });
      if (url.endsWith("/assign?branchId=" + ids.branch) || url.endsWith("/complete?branchId=" + ids.branch)) return Response.json(action);
      if (url.includes("/items/")) return Response.json(lineResponse);
      if (url.endsWith("/release?branchId=" + ids.branch)) return Response.json(release);
      return Response.json(incident);
    };
    const repository = new ApiPickingRepository();
    const scope = { tenantId: id(20), branchId: ids.branch };
    await repository.assign(scope, ids.picking);
    await repository.release(scope, ids.picking, "Cambio de turno");
    await repository.updateItem(scope, ids.picking, ids.item, {
      pickedQuantity: 3.75,
      locationId: null,
      operationId: "stable-operation",
      trackingSelections: [],
    });
    await repository.createIncident(scope, ids.picking, {
      pickingLineId: ids.item, type: PickingIncidentType.quantity_difference, quantityAffected: 0.25, comment: "Diferencia",
    });
    await repository.resolveIncident(scope, ids.picking, ids.incident);
    await repository.complete(scope, ids.picking);

    assert.deepEqual(calls.map((call) => [call.method, call.url]), [
      ["POST", `/api/backend/logistics/picking/${ids.picking}/assign?branchId=${ids.branch}`],
      ["POST", `/api/backend/logistics/picking/${ids.picking}/release?branchId=${ids.branch}`],
      ["PATCH", `/api/backend/logistics/picking/${ids.picking}/items/${ids.item}?branchId=${ids.branch}`],
      ["POST", `/api/backend/logistics/picking/${ids.picking}/incidents?branchId=${ids.branch}`],
      ["PATCH", `/api/backend/logistics/picking/${ids.picking}/incidents/${ids.incident}/resolve?branchId=${ids.branch}`],
      ["POST", `/api/backend/logistics/picking/${ids.picking}/complete?branchId=${ids.branch}`],
    ]);
    assert.deepEqual(calls[1].body, { reason: "Cambio de turno" });
    assert.deepEqual(calls[2].body, {
      pickedQuantity: 3.75, locationId: null, operationId: "stable-operation",
      trackingSelections: [],
    });
    assert.deepEqual(calls[3].body, {
      pickingLineId: ids.item, type: "quantity_difference", quantityAffected: 0.25, comment: "Diferencia",
    });

    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      globalThis.fetch = async () => Response.json({ message: `HTTP ${status}`, code: `ERROR_${status}` }, { status });
      await assert.rejects(
        repository.assign(scope, ids.picking),
        (error) => error instanceof BackendRequestError && error.status === status,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function verifyPhysicalSelections() {
  // Fixture sintetico exclusivo para probar composicion; no representa la respuesta actual del backend.
  const traceableCompositionLine = {
    ...lineResponse,
    name: "Fixture trazable sintetico",
    lot: { id: ids.lotA, number: "LOT-A" },
    availableLots: [
      { id: ids.lotA, number: "LOT-A", expirationDate: "2030-01-01", physicalQuantity: 2.5 },
      { id: ids.lotB, number: "LOT-B", expirationDate: "2030-02-01", physicalQuantity: 1.25 },
    ],
    availableSerialNumbers: ["SER-A", "SER-B"],
    tracking: { stock: true, lot: true, expiration: true, serial: false },
    inventory: {
      ...lineResponse.inventory,
      locations: [{
        ...lineResponse.inventory.locations[0],
        lots: [
          { lotId: ids.lotA, lotNumber: "LOT-A", expirationDate: "2030-01-01", physicalQuantity: 2.5, serialNumbers: [{ id: ids.serialA, serialNumber: "SER-A" }] },
          { lotId: ids.lotB, lotNumber: "LOT-B", expirationDate: "2030-02-01", physicalQuantity: 1.25, serialNumbers: [{ id: ids.serialB, serialNumber: "SER-B" }] },
        ],
        serialNumbers: [
          { id: ids.serialA, serialNumber: "SER-A", lotId: ids.lotA },
          { id: ids.serialB, serialNumber: "SER-B", lotId: ids.lotB },
        ],
      }],
    },
  };
  const lotLine = {
    ...traceableCompositionLine,
    pickedQuantity: 2.5,
    remainingQuantity: 1.25,
    status: "partial",
    trackingSelections: [{ locationId: ids.location, lotId: ids.lotA, lotNumber: "LOT-A", expirationDate: "2030-01-01", quantity: 2.5, serialNumbers: [] }],
  } as PickingDetailLineDto;
  const split = buildPickingPhysicalSelection(lotLine, 3.75, {
    locationId: ids.location, lotId: ids.lotB, serialNumbers: [],
  });
  assert.deepEqual(split.trackingSelections.map(({ lotId, quantity }) => ({ lotId, quantity })), [
    { lotId: ids.lotA, quantity: 2.5 }, { lotId: ids.lotB, quantity: 1.25 },
  ]);

  const serialLine = {
    ...lotLine,
    requiredQuantity: 2,
    pickedQuantity: 1,
    remainingQuantity: 1,
    tracking: { stock: true, lot: true, expiration: true, serial: true },
    serialNumbers: ["SER-A"],
    trackingSelections: [{ ...lotLine.trackingSelections[0], quantity: 1, serialNumbers: ["SER-A"] }],
  } as PickingDetailLineDto;
  const serial = buildPickingPhysicalSelection(serialLine, 2, {
    locationId: ids.location, lotId: ids.lotB, serialNumbers: ["SER-B"],
  });
  assert.deepEqual(serial.trackingSelections.map(({ lotId, quantity, serialNumbers }) => ({ lotId, quantity, serialNumbers })), [
    { lotId: ids.lotA, quantity: 1, serialNumbers: ["SER-A"] },
    { lotId: ids.lotB, quantity: 1, serialNumbers: ["SER-B"] },
  ]);
  assert.deepEqual(buildPickingSerialReplacement(serialLine, ["SER-B", "SER-A"]).trackingSelections.length, 2);
  const mixedSerialLine = {
    ...serialLine,
    pickedQuantity: 0,
    remainingQuantity: 2,
    serialNumbers: [],
    trackingSelections: [],
    availableLots: [traceableCompositionLine.availableLots[0]],
    availableSerialNumbers: ["GOOD", "BAD"],
    inventory: {
      ...serialLine.inventory,
      locations: [{
        ...serialLine.inventory.locations[0],
        lots: [serialLine.inventory.locations[0].lots[0]],
        serialNumbers: [
          { id: ids.serialA, serialNumber: "GOOD", lotId: ids.lotA },
          { id: ids.serialB, serialNumber: "BAD", lotId: ids.lotB },
        ],
      }],
    },
  } as PickingDetailLineDto;
  assert.equal(getPickingLineUpdateAvailability(mixedSerialLine).available, true);
  assert.deepEqual(getPickingLocationSerials(mixedSerialLine, ids.location), ["GOOD"]);
  assert.deepEqual(getPickingLocationLots(mixedSerialLine, ids.location).map((lot) => lot.lotId), [ids.lotA]);
  assert.equal(
    buildPickingPhysicalSelection(mixedSerialLine, 1, {
      locationId: ids.location, lotId: ids.lotA, serialNumbers: ["GOOD"],
    }).trackingSelections[0]?.lotId,
    ids.lotA,
  );
  assert.throws(
    () => buildPickingPhysicalSelection(mixedSerialLine, 1, {
      locationId: ids.location, lotId: ids.lotB, serialNumbers: ["BAD"],
    }),
    /no es canonica/,
  );
  const mixedLotLine = {
    ...lotLine,
    availableLots: [traceableCompositionLine.availableLots[0]],
  } as PickingDetailLineDto;
  assert.throws(
    () => buildPickingPhysicalSelection(mixedLotLine, 3.75, {
      locationId: ids.location, lotId: ids.lotB, serialNumbers: [],
    }),
    /no esta disponible/,
  );
  assert.equal(validatePickingLineUpdate(lotLine, 3.75, []), null);
  assert.equal(validatePickingLineUpdate(lotLine, 3.7501, [])?.includes("3 decimales"), true);
  assert.equal(normalizePickingQuantity(0.1), 0.1);
  assert.equal(normalizePickingQuantity(1.255), 1.255);
  assert.throws(() => normalizePickingQuantity(1.2551), /3 decimales/);
  for (const [left, right, expected] of [
    [0.1, 0.1, 0.2],
    [0.1, 0.2, 0.3],
    [0.125, 0.125, 0.25],
    [0.333, 0.333, 0.666],
    [0.001, 0.002, 0.003],
  ]) {
    const decimalLine = {
      ...lotLine,
      pickedQuantity: left,
      trackingSelections: [{ ...lotLine.trackingSelections[0], quantity: left }],
    };
    const decimalSelection = buildPickingPhysicalSelection(decimalLine, expected, {
      locationId: ids.location, lotId: ids.lotA, serialNumbers: [],
    });
    assert.equal(decimalSelection.trackingSelections[0].quantity, expected);
    assert.equal(JSON.stringify(decimalSelection).includes("00000000000000004"), false);
    assert.equal(normalizePickingQuantity(right), right);
  }
  assert.equal(validatePickingIncident({
    pickingLineId: ids.item,
    type: PickingIncidentType.quantity_difference,
    quantityAffected: "0.125",
    comment: "Diferencia decimal",
  }).valid, true);
}

function verifyBackendTraceabilityDegradation() {
  assert.equal(getPickingLineUpdateAvailability(lineResponse as PickingDetailLineDto).available, true);
  const backendTraceableLine = {
    ...lineResponse,
    tracking: { stock: true, lot: true, expiration: true, serial: false },
  } as PickingDetailLineDto;
  const availability = getPickingLineUpdateAvailability(backendTraceableLine);
  assert.equal(availability.available, false);
  assert.match(availability.reason ?? "", /lotes canonicos/);
  assert.throws(
    () => buildPickingPhysicalSelection(backendTraceableLine, 3.75, {
      locationId: ids.location, lotId: ids.lotA, serialNumbers: [],
    }),
    /lotes canonicos/,
  );
}

function verifyStaleResponseGuard() {
  assert.equal(isCurrentPickingRequest({
    sequence: 4,
    currentSequence: 5,
    requestedBranchId: ids.branch,
    activeBranchId: ids.branch,
  }), false);
  assert.equal(isCurrentPickingRequest({
    sequence: 5,
    currentSequence: 5,
    requestedBranchId: ids.branch,
    activeBranchId: ids.branch,
    requestedPickingOrderId: ids.picking,
    selectedPickingOrderId: id(99),
  }), false);
}

function verifyCanonicalOperationFingerprint() {
  const selectionA = {
    locationId: ids.location,
    lotId: ids.lotA,
    quantity: 0.125,
    serialNumbers: ["SER-B", "SER-A"],
  };
  const selectionB = {
    locationId: ids.location,
    lotId: ids.lotB,
    quantity: 0.25,
    serialNumbers: [],
  };
  const fingerprint = (trackingSelections: typeof selectionA[]) => createPickingUpdateFingerprint({
    pickingOrderId: ids.picking,
    pickingLineId: ids.item,
    targetQuantity: 0.375,
    locationId: ids.location,
    trackingSelections,
  });
  const firstFingerprint = fingerprint([selectionA, selectionB]);
  const reorderedFingerprint = fingerprint([selectionB, selectionA]);
  assert.equal(reorderedFingerprint, firstFingerprint);

  const pending = new Map<string, string>();
  let nextId = 0;
  const createId = () => `canonical-operation-${++nextId}`;
  const firstId = getOrCreatePickingOperationId(pending, firstFingerprint, createId);
  const reorderedId = getOrCreatePickingOperationId(pending, reorderedFingerprint, createId);
  assert.equal(reorderedId, firstId);

  const changedFingerprint = fingerprint([
    { ...selectionA, quantity: 0.126 },
    selectionB,
  ]);
  assert.notEqual(changedFingerprint, firstFingerprint);
  assert.notEqual(
    getOrCreatePickingOperationId(pending, changedFingerprint, createId),
    firstId,
  );
}

void main();
