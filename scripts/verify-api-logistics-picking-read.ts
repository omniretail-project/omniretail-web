import assert from "node:assert/strict";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ApiPickingRepository } from "@/infrastructure/api/repositories/ApiPickingRepository";
import {
  parseApiPickingDetail,
  parseApiPickingQueue,
} from "@/infrastructure/api/repositories/pickingApi.schema";
import { withApiLogisticsPickingRead } from "@/infrastructure/api/withApiLogisticsPickingRead";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  toPickingDetailDto,
  toPickingQueueItemDto,
} from "@/modules/logistics/application/mappers/PickingApiMapper";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";
import { isCurrentPickingRequest } from "@/modules/logistics/hooks/pickingRequestIdentity";

const ids = {
  tenant: "10000000-0000-4000-8000-000000000001",
  branch: "10000000-0000-4000-8000-000000000002",
  picking: "10000000-0000-4000-8000-000000000003",
  order: "10000000-0000-4000-8000-000000000004",
  product: "10000000-0000-4000-8000-000000000005",
  line: "10000000-0000-4000-8000-000000000006",
  orderLine: "10000000-0000-4000-8000-000000000007",
  user: "10000000-0000-4000-8000-000000000008",
  role: "10000000-0000-4000-8000-000000000009",
  locationA: "10000000-0000-4000-8000-000000000010",
  locationB: "10000000-0000-4000-8000-000000000011",
  balanceA: "10000000-0000-4000-8000-000000000012",
  balanceB: "10000000-0000-4000-8000-000000000013",
  lot: "10000000-0000-4000-8000-000000000014",
  serial: "10000000-0000-4000-8000-000000000015",
  incident: "10000000-0000-4000-8000-000000000016",
  release: "10000000-0000-4000-8000-000000000017",
  transfer: "10000000-0000-4000-8000-000000000018",
  transferPicking: "10000000-0000-4000-8000-000000000019",
};

const progress = {
  requiredQuantity: 3.75,
  pickedQuantity: 1.25,
  remainingQuantity: 2.5,
  percentage: 33,
};

const orderQueueResponse = {
  pickingOrderId: ids.picking,
  orderId: ids.order,
  orderReference: "ORD-2026-001",
  customerName: "Ana Pérez",
  storePickupContact: null,
  deliveryMethod: "home_delivery",
  branchId: ids.branch,
  status: "in_progress",
  priority: "high",
  assignedUserId: ids.user,
  progress,
  startedAt: "2026-10-07T14:00:00Z",
  createdAt: "2026-10-07T13:00:00Z",
  updatedAt: "2026-10-07T14:30:00Z",
  sourceType: "order",
  sourceId: ids.order,
  sourceReference: "ORD-2026-001",
};

const transferQueueResponse = {
  ...orderQueueResponse,
  pickingOrderId: ids.transferPicking,
  orderId: null,
  orderReference: null,
  customerName: null,
  deliveryMethod: null,
  assignedUserId: null,
  startedAt: null,
  sourceType: "transfer",
  sourceId: ids.transfer,
  sourceReference: "TR-2026-001",
};

const detailResponse = {
  ...orderQueueResponse,
  completedAt: null,
  lines: [
    {
      pickingLineId: ids.line,
      orderItemId: ids.orderLine,
      productId: ids.product,
      sku: "SKU-DECIMAL",
      name: "Producto trazable",
      requiredQuantity: 3.75,
      pickedQuantity: 1.25,
      remainingQuantity: 2.5,
      status: "partial",
      location: { id: ids.locationA, code: "A-01", name: "Pasillo A" },
      lot: { id: ids.lot, number: "LOT-2030" },
      serialNumbers: ["SER-001"],
      availableLocations: [
        {
          id: ids.locationA,
          code: "A-01",
          name: "Pasillo A",
          ownReservedQuantity: 1.25,
          usableQuantity: 6.5,
        },
        {
          id: ids.locationB,
          code: "B-02",
          name: "Pasillo B",
          ownReservedQuantity: 0,
          usableQuantity: 4.25,
        },
      ],
      availableLots: [
        { id: ids.lot, number: "LOT-2030", expirationDate: "2030-02-20", physicalQuantity: 5.75 },
      ],
      availableSerialNumbers: ["SER-001", "SER-002"],
      tracking: { stock: true, lot: true, expiration: true, serial: true },
      inventory: {
        tenantId: ids.tenant,
        branchId: ids.branch,
        pickingOrderId: ids.picking,
        orderId: ids.order,
        productId: ids.product,
        physicalQuantity: 12.5,
        ownReservedQuantity: 1.25,
        otherReservedQuantity: 2.75,
        freeQuantity: 8.5,
        usableQuantity: 9.75,
        locations: [
          {
            balanceId: ids.balanceA,
            locationId: ids.locationA,
            locationCode: "A-01",
            locationName: "Pasillo A",
            physicalQuantity: 7.25,
            ownReservedQuantity: 1.25,
            otherReservedQuantity: 1,
            freeQuantity: 5,
            usableQuantity: 6.25,
            lots: [
              {
                lotId: ids.lot,
                lotNumber: "LOT-2030",
                expirationDate: "2030-02-20",
                physicalQuantity: 5.75,
                serialNumbers: [{ id: ids.serial, serialNumber: "SER-001" }],
              },
            ],
            serialNumbers: [{ id: ids.serial, serialNumber: "SER-001", lotId: ids.lot }],
          },
          {
            balanceId: ids.balanceB,
            locationId: ids.locationB,
            locationCode: "B-02",
            locationName: "Pasillo B",
            physicalQuantity: 5.25,
            ownReservedQuantity: 0,
            otherReservedQuantity: 1.75,
            freeQuantity: 3.5,
            usableQuantity: 3.5,
            lots: [],
            serialNumbers: [],
          },
        ],
      },
      sourceLineId: ids.orderLine,
      trackingSelections: [
        {
          locationId: ids.locationA,
          lotId: ids.lot,
          lotNumber: "LOT-2030",
          expirationDate: "2030-02-20",
          quantity: 1.25,
          serialNumbers: ["SER-001"],
        },
      ],
    },
  ],
  incidents: [
    {
      id: ids.incident,
      pickingOrderId: ids.picking,
      pickingLineId: ids.line,
      type: "quantity_difference",
      quantityAffected: 0.5,
      comment: "Diferencia física",
      status: "open",
      createdBy: ids.user,
      createdAt: "2026-10-07T14:10:00Z",
      resolvedBy: null,
      resolvedAt: null,
    },
  ],
  releases: [
    {
      id: ids.release,
      pickingOrderId: ids.picking,
      actorUserId: ids.user,
      reason: "Cambio de turno",
      releasedAt: "2026-10-07T14:20:00Z",
    },
  ],
};

const transferDetailResponse = {
  ...detailResponse,
  ...transferQueueResponse,
  lines: detailResponse.lines.map((line) => ({
    ...line,
    orderItemId: null,
    inventory: {
      ...line.inventory,
      pickingOrderId: ids.transferPicking,
      orderId: null,
    },
  })),
  incidents: [],
  releases: [],
};

async function main() {
  const queue = parseApiPickingQueue([orderQueueResponse, transferQueueResponse]);
  const detail = parseApiPickingDetail(detailResponse);
  const transferDetail = parseApiPickingDetail(transferDetailResponse);
  const mappedOrder = toPickingDetailDto(detail);
  const mappedTransfer = toPickingQueueItemDto(queue[1]);
  const mappedTransferDetail = toPickingDetailDto(transferDetail);

  assert.equal(mappedOrder.lines[0].requiredQuantity, 3.75);
  assert.equal(mappedOrder.lines[0].inventory.otherReservedQuantity, 2.75);
  assert.equal(mappedOrder.lines[0].inventory.locations.length, 2);
  assert.equal(mappedOrder.lines[0].availableLots[0].expirationDate, "2030-02-20");
  assert.deepEqual(mappedOrder.lines[0].availableSerialNumbers, ["SER-001", "SER-002"]);
  assert.equal(mappedOrder.lines[0].trackingSelections[0].quantity, 1.25);
  assert.equal(mappedTransfer.deliveryMethod, "transfer");
  assert.equal(mappedTransfer.orderReference, "TR-2026-001");
  assert.equal(mappedTransfer.orderId, undefined);
  assert.equal(mappedTransferDetail.lines[0].orderItemId, undefined);
  assert.equal(mappedTransferDetail.lines[0].inventory.orderId, undefined);

  assert.throws(
    () => parseApiPickingQueue([{ ...orderQueueResponse, pickingOrderId: "mock-id" }]),
    (error) => error instanceof BackendRequestError && error.status === 502,
  );
  assert.throws(
    () =>
      parseApiPickingDetail({
        ...detailResponse,
        lines: [
          {
            ...detailResponse.lines[0],
            availableLots: [
              { ...detailResponse.lines[0].availableLots[0], expirationDate: "20/02/2030" },
            ],
          },
        ],
      }),
    (error) => error instanceof BackendRequestError && error.status === 502,
  );

  await verifyRepositoryRoutesAndErrors();
  await verifyApplicationBoundary(queue, detail);

  const wrapped = withApiLogisticsPickingRead({} as RepositoryRegistry);
  assert.equal(wrapped.pickingReadDataSource, "api");
  assert.equal(wrapped.pickingCommandsEnabled, true);
  assert.ok(wrapped.pickingRead instanceof ApiPickingRepository);
  assert.ok(wrapped.pickingCommands instanceof ApiPickingRepository);

  assert.equal(
    isCurrentPickingRequest({
      sequence: 2,
      currentSequence: 2,
      requestedBranchId: ids.branch,
      activeBranchId: ids.branch,
    }),
    true,
  );
  assert.equal(
    isCurrentPickingRequest({
      sequence: 1,
      currentSequence: 2,
      requestedBranchId: ids.branch,
      activeBranchId: "20000000-0000-4000-8000-000000000001",
    }),
    false,
  );

  console.log("API Logistics Picking read schemas, mapping, isolation and request identity: PASS");
}

async function verifyRepositoryRoutesAndErrors() {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      const body = String(input).includes(`/${ids.picking}`)
        ? detailResponse
        : [orderQueueResponse];
      return Response.json(body);
    };
    const repository = new ApiPickingRepository();
    await repository.getQueue({ tenantId: ids.tenant, branchId: ids.branch });
    await repository.getDetail({ tenantId: ids.tenant, branchId: ids.branch }, ids.picking);
    assert.deepEqual(calls, [
      `/api/backend/logistics/picking?branchId=${ids.branch}`,
      `/api/backend/logistics/picking/${ids.picking}?branchId=${ids.branch}`,
    ]);

    for (const status of [401, 403, 404]) {
      globalThis.fetch = async () =>
        Response.json({ message: `HTTP ${status}`, code: `ERROR_${status}` }, { status });
      await assert.rejects(
        repository.getQueue({ tenantId: ids.tenant, branchId: ids.branch }),
        (error) => error instanceof BackendRequestError && error.status === status,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyApplicationBoundary(
  queue: ReturnType<typeof parseApiPickingQueue>,
  detail: ReturnType<typeof parseApiPickingDetail>,
) {
  let forbiddenMockReads = 0;
  const forbidden = new Proxy(
    {},
    {
      get() {
        return () => {
          forbiddenMockReads += 1;
          throw new Error("Mock fallback invoked");
        };
      },
    },
  );
  const repositories = {
    auth: {
      getCurrentSessionId: async () => "session-api-picking",
      getSession: async () => ({
        id: "session-api-picking",
        userId: ids.user,
        createdAt: "2026-10-07T00:00:00Z",
        expiresAt: "2099-10-07T00:00:00Z",
        rememberMe: false,
      }),
    },
    users: {
      getById: async () => ({
        id: ids.user,
        tenantId: ids.tenant,
        name: "Operador",
        email: "operador@example.com",
        type: "employee",
        status: "active",
        roleId: ids.role,
        allowedBranchIds: [ids.branch],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    },
    roles: {
      getByIdScoped: async () => ({
        id: ids.role,
        tenantId: ids.tenant,
        name: "Bodega",
        isSystem: true,
        permissions: ["logistics.picking.read", "logistics.picking.start"],
        branchScope: "assigned",
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    },
    branches: {
      getById: async () => ({
        id: ids.branch,
        tenantId: ids.tenant,
        code: "MAIN",
        name: "Principal",
        type: "store",
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    },
    pickingRead: {
      getQueue: async () => queue,
      getDetail: async () => detail,
    },
    pickingCommandsEnabled: false,
    picking: forbidden,
    customers: forbidden,
    orders: forbidden,
    products: forbidden,
    inventory: forbidden,
    inventoryTransfers: forbidden,
  } as unknown as RepositoryRegistry;

  const service = new PickingApplicationService(repositories);
  assert.equal((await service.getQueue(ids.branch)).length, 2);
  assert.equal((await service.getDetail(ids.branch, ids.picking)).lines.length, 1);
  assert.equal(
    (await service.getInventoryAvailability(ids.branch, ids.picking, ids.product)).usableQuantity,
    9.75,
  );
  assert.equal(forbiddenMockReads, 0);
  await assert.rejects(
    service.assign(ids.branch, ids.picking),
    (error) =>
      error instanceof BackendRequestError &&
      error.code === "PICKING_COMMANDS_NOT_AVAILABLE" &&
      error.status === 409,
  );
  assert.equal(forbiddenMockReads, 0);
}

void main();
