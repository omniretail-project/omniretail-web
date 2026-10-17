import assert from "node:assert/strict";
import { DeliveryMethod, OrderStatus, PackingStatus } from "@/core/enums";
import type {
  PackingDetailReadModel,
  PackingQueueReadModel,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ApiPackingRepository } from "@/infrastructure/api/repositories/ApiPackingRepository";
import {
  parseApiPackingDetail,
  parseApiPackingQueue,
  parseSavePackingPreparationCommand,
} from "@/infrastructure/api/repositories/packingApi.schema";
import { withApiLogisticsPacking } from "@/infrastructure/api/withApiLogisticsPacking";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { PackingApplicationService } from "@/modules/logistics/application/services/PackingApplicationService";
import { toPackingDetailDto } from "@/modules/logistics/application/mappers/PackingApiMapper";
import {
  createPackingOperationFingerprint,
  getOrCreatePackingOperationId,
  isCurrentPackingRequest,
  isPackingVersionCurrentOrNewer,
  PackingMutationCoordinator,
  resolvePackingMutationSnapshot,
  shouldRetainPackingOperationIdentity,
} from "@/modules/logistics/hooks/packingRequestIdentity";
import { printPackingLabel } from "@/modules/logistics/components/PackingWorkspace";
import { PackingMutationSessionScope } from "@/modules/logistics/providers/PackingMutationCoordinatorProvider";
import { validatePackingPreparation } from "@/modules/logistics/validation/packing.validation";

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = {
  tenant: id(1), branch: id(2), user: id(3), role: id(4), packing: id(5),
  order: id(6), picking: id(7), source: id(8), product: id(9), location: id(10), lot: id(11),
};

const queueItem = {
  packingId: ids.packing,
  orderId: ids.order,
  orderReference: "ORD-100",
  customerName: "Cliente API",
  storePickupContact: null,
  deliveryMethod: "home_delivery",
  sourceType: "order",
  sourceId: ids.order,
  status: "in_progress",
  version: 3,
  startedAt: "2026-10-07T12:00:00Z",
  updatedAt: "2026-10-07T13:00:00Z",
  sourceReference: "ORD-100",
} as const;

const detailResponse = {
  ...queueItem,
  pickingOrderId: ids.picking,
  orderStatus: "packing",
  deliveryAddress: {
    recipientName: "Cliente API",
    recipientPhone: "55550000",
    line1: "Zona 1",
    line2: null,
    city: "Guatemala",
    references: null,
    country: "Guatemala",
  },
  checklist: {
    packageProtectionChecked: true,
    documentIncludedChecked: true,
    recipientVerifiedChecked: true,
  },
  totalWeight: 2.125,
  packageCount: 1,
  labelGenerationId: "generation-1",
  labelCode: "LBL-ORD-100-3",
  labelGeneratedAt: "2026-10-07T13:00:00Z",
  labelPrintedAt: null,
  finalizedAt: null,
  preparedContents: [{
    productId: ids.product,
    sku: "TRACE-1",
    name: "Producto trazable",
    quantity: 1.25,
    serialNumbers: ["SER-1"],
    trackingSelections: [{
      locationId: ids.location,
      lotId: ids.lot,
      lotNumber: "LOT-1",
      expirationDate: "2030-01-15",
      quantity: 1.25,
      serialNumbers: ["SER-1"],
    }],
  }],
} as const;

async function main() {
  verifySchemasAndValidation();
  await verifyRoutesBodiesAndErrors();
  await verifyApplicationIsolationAndPermissions();
  await verifyRequestIdentityAndIdempotency();
  verifyBlockedPrintDoesNotRegister();
  const wrapped = withApiLogisticsPacking({} as RepositoryRegistry);
  assert.equal(wrapped.packingDataSource, "api");
  assert.equal(wrapped.packingRead, wrapped.packingCommands);
  console.log("verify-api-logistics-packing: PASS");
}

function verifySchemasAndValidation() {
  const parsed = parseApiPackingDetail(detailResponse);
  assert.equal(parsed.preparedContents[0]?.trackingSelections[0]?.lotNumber, "LOT-1");
  assert.equal(parsed.totalWeight, 2.125);

  const transfer = {
    ...queueItem,
    orderId: null,
    orderReference: null,
    customerName: null,
    deliveryMethod: null,
    sourceType: "transfer",
    sourceId: ids.source,
    sourceReference: "TR-100",
  };
  assert.equal(parseApiPackingQueue([transfer])[0]?.sourceType, "transfer");
  assert.throws(
    () => withoutExpectedSchemaWarning(
      () => parseApiPackingQueue([{ ...transfer, customerName: "dato de order" }]),
    ),
    (error) => error instanceof BackendRequestError && error.status === 502,
  );
  assert.throws(
    () => withoutExpectedSchemaWarning(
      () => parseApiPackingDetail({ ...detailResponse, version: -1 }),
    ),
    (error) => error instanceof BackendRequestError && error.code === "INVALID_BACKEND_RESPONSE",
  );
  assert.throws(
    () => parseSavePackingPreparationCommand({
      expectedVersion: 0,
      operationId: "operation",
      checklist: detailResponse.checklist,
      totalWeight: 1.2345,
      packageCount: 1,
    }),
    (error) => error instanceof BackendRequestError && error.status === 400,
  );

  const pickupForm = {
    checklist: { ...detailResponse.checklist },
    totalWeight: "2.125",
    packageCount: "1",
  };
  assert.equal(
    validatePackingPreparation(DeliveryMethod.store_pickup, pickupForm).values.totalWeight,
    undefined,
  );
  assert.equal(
    validatePackingPreparation(DeliveryMethod.store_pickup, pickupForm, {
      requireShipmentData: true,
      backendPrecision: true,
    }).values.totalWeight,
    2.125,
  );
  assert.equal(
    validatePackingPreparation(DeliveryMethod.home_delivery, {
      ...pickupForm,
      totalWeight: "2.1251",
    }, { backendPrecision: true }).valid,
    false,
  );
}

function withoutExpectedSchemaWarning<T>(execute: () => T): T {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    return execute();
  } finally {
    console.warn = originalWarn;
  }
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
      if (url.endsWith(`/logistics/packing?branchId=${ids.branch}`)) {
        return Response.json([queueItem]);
      }
      if (url.endsWith(`/finalize?branchId=${ids.branch}`)) {
        return Response.json({
          packing: { ...detailResponse, status: "finalized", version: 4,
            finalizedAt: "2026-10-07T14:00:00Z" },
          idempotent: false,
          orderStatus: "ready_for_dispatch",
          transferStatus: null,
        });
      }
      if (url.includes("/preparation?") || url.includes("/label?") || url.includes("/label/print?")) {
        return Response.json({ packing: detailResponse, idempotent: false });
      }
      return Response.json(detailResponse);
    };

    const repository = new ApiPackingRepository();
    const scope = { tenantId: ids.tenant, branchId: ids.branch };
    await repository.getQueue(scope);
    await repository.getDetail(scope, ids.packing);
    await repository.savePreparation(scope, ids.packing, {
      expectedVersion: 3,
      operationId: "prepare-1",
      checklist: detailResponse.checklist,
      totalWeight: 2.125,
      packageCount: 1,
    });
    await repository.generateLabel(scope, ids.packing, {
      expectedVersion: 3,
      operationId: "label-1",
    });
    await repository.registerLabelPrint(scope, ids.packing, {
      expectedVersion: 3,
      operationId: "print-1",
      labelGenerationId: "generation-1",
    });
    await repository.finalize(scope, ids.packing, {
      expectedVersion: 3,
      operationId: "finalize-1",
    });

    assert.deepEqual(calls.map((call) => [call.method, call.url]), [
      ["GET", `/api/backend/logistics/packing?branchId=${ids.branch}`],
      ["GET", `/api/backend/logistics/packing/${ids.packing}?branchId=${ids.branch}`],
      ["PATCH", `/api/backend/logistics/packing/${ids.packing}/preparation?branchId=${ids.branch}`],
      ["POST", `/api/backend/logistics/packing/${ids.packing}/label?branchId=${ids.branch}`],
      ["POST", `/api/backend/logistics/packing/${ids.packing}/label/print?branchId=${ids.branch}`],
      ["POST", `/api/backend/logistics/packing/${ids.packing}/finalize?branchId=${ids.branch}`],
    ]);
    assert.deepEqual(calls[2]?.body, {
      expectedVersion: 3,
      operationId: "prepare-1",
      checklist: detailResponse.checklist,
      totalWeight: 2.125,
      packageCount: 1,
    });
    assert.deepEqual(calls[4]?.body, {
      expectedVersion: 3,
      operationId: "print-1",
      labelGenerationId: "generation-1",
    });

    for (const status of [400, 401, 403, 404, 409, 500]) {
      globalThis.fetch = async () => Response.json(
        { message: `HTTP ${status}`, code: `ERROR_${status}` },
        { status },
      );
      await assert.rejects(
        repository.getDetail(scope, ids.packing),
        (error) => error instanceof BackendRequestError && error.status === status,
      );
    }
    globalThis.fetch = async () => { throw new TypeError("network"); };
    await assert.rejects(
      repository.getQueue(scope),
      (error) => error instanceof BackendRequestError && error.status === 0,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyApplicationIsolationAndPermissions() {
  let forbiddenCalls = 0;
  let commandCalls = 0;
  let detailReads = 0;
  const forbiddenMock = new Proxy({}, {
    get() {
      return () => {
        forbiddenCalls += 1;
        throw new Error("Mock repository invoked");
      };
    },
  });
  const detail = parseApiPackingDetail(detailResponse);
  const queue = parseApiPackingQueue([queueItem]);
  const packingRead = {
    getQueue: async (): Promise<PackingQueueReadModel[]> => queue,
    getDetail: async (): Promise<PackingDetailReadModel> => {
      detailReads += 1;
      return detail;
    },
  };
  const packingCommands = {
    savePreparation: async () => { commandCalls += 1; return { packing: detail, idempotent: false }; },
    generateLabel: async () => { commandCalls += 1; return { packing: detail, idempotent: false }; },
    registerLabelPrint: async () => { commandCalls += 1; return { packing: detail, idempotent: false }; },
    finalize: async () => {
      commandCalls += 1;
      return { packing: { ...detail, status: PackingStatus.finalized }, idempotent: false,
        orderStatus: OrderStatus.ready_for_dispatch, transferStatus: null };
    },
  };
  const repositories = createAuthorizedRepositories({
    packingRead,
    packingCommands,
    packings: forbiddenMock,
    orders: forbiddenMock,
    customers: forbiddenMock,
    products: forbiddenMock,
    picking: forbiddenMock,
    inventoryTransfers: forbiddenMock,
    storePickupDeliveries: forbiddenMock,
  });
  const service = new PackingApplicationService(repositories);
  assert.equal((await service.getQueue(ids.branch))[0]?.orderReference, "ORD-100");
  await service.getDetail(ids.branch, ids.packing);
  await service.savePreparation(ids.branch, {
    packingId: ids.packing, operationId: "prepare", expectedVersion: 3,
    checklist: detailResponse.checklist, totalWeight: 2.125, packageCount: 1,
  });
  await service.generateLabel(ids.branch, {
    packingId: ids.packing, operationId: "label", expectedVersion: 3,
  });
  await service.registerLabelPrint(ids.branch, {
    packingId: ids.packing, operationId: "print", expectedVersion: 3,
    labelGenerationId: "generation-1",
  });
  await service.finalize(ids.branch, {
    packingId: ids.packing, operationId: "finalize", expectedVersion: 3,
  });
  await assert.rejects(
    service.confirmStorePickupDelivery(ids.branch, { packingId: ids.packing, operationId: "x" }),
    (error) => error instanceof BackendRequestError &&
      error.code === "STORE_PICKUP_HANDOVER_NOT_AVAILABLE",
  );
  assert.equal(commandCalls, 4);
  assert.equal(detailReads, 1);
  assert.equal(forbiddenCalls, 0);

  const denied = new PackingApplicationService(createAuthorizedRepositories({
    packingRead,
    packingCommands,
    roles: { getByIdScoped: async () => ({
      id: ids.role, tenantId: ids.tenant, name: "Sin permisos", isSystem: false,
      permissions: [], branchScope: "assigned", status: "active",
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    }) },
  }));
  await assert.rejects(denied.getQueue(ids.branch), /access denied/i);

  const missingApiAdapter = new PackingApplicationService(createAuthorizedRepositories({
    packings: forbiddenMock,
  }));
  await assert.rejects(
    missingApiAdapter.getQueue(ids.branch),
    (error) => error instanceof BackendRequestError && error.code === "PACKING_API_NOT_CONFIGURED",
  );
  assert.equal(forbiddenCalls, 0);
}

function createAuthorizedRepositories(overrides: Record<string, unknown>) {
  return {
    packingDataSource: "api",
    auth: {
      getCurrentSessionId: async () => "session",
      getSession: async () => ({ id: "session", userId: ids.user,
        createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
        rememberMe: false }),
    },
    users: { getById: async () => ({
      id: ids.user, tenantId: ids.tenant, name: "Empacador", email: "packing@example.com",
      type: "employee", status: "active", roleId: ids.role, allowedBranchIds: [ids.branch],
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    }) },
    roles: { getByIdScoped: async () => ({
      id: ids.role, tenantId: ids.tenant, name: "Packing", isSystem: false,
      permissions: ["logistics.packing.read", "logistics.packing.prepare", "logistics.packing.finalize"],
      branchScope: "assigned", status: "active",
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    }) },
    branches: { getById: async () => ({
      id: ids.branch, tenantId: ids.tenant, code: "MAIN", name: "Principal",
      type: "store", status: "active", createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }) },
    ...overrides,
  } as unknown as RepositoryRegistry;
}

async function verifyRequestIdentityAndIdempotency() {
  assert.equal(isCurrentPackingRequest({
    sequence: 3, currentSequence: 4, requestedBranchId: ids.branch,
    activeBranchId: ids.branch,
  }), false);
  assert.equal(isCurrentPackingRequest({
    sequence: 4, currentSequence: 4, requestedBranchId: ids.branch,
    activeBranchId: ids.branch, requestedPackingId: ids.packing,
    selectedPackingId: id(99),
  }), false);
  assert.equal(isPackingVersionCurrentOrNewer(5, 4), false);
  assert.equal(isPackingVersionCurrentOrNewer(5, 5), true);

  const pending = new Map<string, string>();
  let nextId = 0;
  const createId = () => `operation-${++nextId}`;
  const firstFingerprint = createPackingOperationFingerprint({
    action: "save", branchId: ids.branch, packingId: ids.packing, expectedVersion: 3,
    payload: { totalWeight: 2.125, packageCount: 1 },
  });
  const retryId = getOrCreatePackingOperationId(pending, firstFingerprint, createId);
  assert.equal(getOrCreatePackingOperationId(pending, firstFingerprint, createId), retryId);
  const changedPayload = createPackingOperationFingerprint({
    action: "save", branchId: ids.branch, packingId: ids.packing, expectedVersion: 3,
    payload: { totalWeight: 2.5, packageCount: 1 },
  });
  const changedVersion = createPackingOperationFingerprint({
    action: "save", branchId: ids.branch, packingId: ids.packing, expectedVersion: 4,
    payload: { totalWeight: 2.125, packageCount: 1 },
  });
  const changedBranch = createPackingOperationFingerprint({
    action: "save", branchId: id(12), packingId: ids.packing, expectedVersion: 3,
    payload: { totalWeight: 2.125, packageCount: 1 },
  });
  const changedAction = createPackingOperationFingerprint({
    action: "finalize", branchId: ids.branch, packingId: ids.packing, expectedVersion: 3,
    payload: { totalWeight: 2.125, packageCount: 1 },
  });
  const changedPacking = createPackingOperationFingerprint({
    action: "save", branchId: ids.branch, packingId: id(13), expectedVersion: 3,
    payload: { totalWeight: 2.125, packageCount: 1 },
  });
  assert.notEqual(getOrCreatePackingOperationId(pending, changedPayload, createId), retryId);
  assert.notEqual(getOrCreatePackingOperationId(pending, changedVersion, createId), retryId);
  assert.notEqual(getOrCreatePackingOperationId(pending, changedBranch, createId), retryId);
  assert.notEqual(getOrCreatePackingOperationId(pending, changedAction, createId), retryId);
  assert.notEqual(getOrCreatePackingOperationId(pending, changedPacking, createId), retryId);

  let readBacks = 0;
  const historical = { version: 3 };
  const current = { version: 5 };
  assert.equal((await resolvePackingMutationSnapshot({
    packing: historical,
    idempotent: true,
    readCurrent: async () => { readBacks += 1; return current; },
  })).version, 5);
  assert.equal((await resolvePackingMutationSnapshot({
    packing: current,
    idempotent: false,
    readCurrent: async () => { readBacks += 1; return historical; },
  })).version, 5);
  assert.equal(readBacks, 1);

  await verifyCrossBranchMutationCoordination();
  await verifyCompositeMutationContextInvalidation();
  verifyOperationIdentityRetention();
}

async function verifyCrossBranchMutationCoordination() {
  const sessionScope = new PackingMutationSessionScope({
    sessionId: "session-a", userId: ids.user, tenantId: ids.tenant,
  });
  const coordinator = sessionScope.coordinator;
  const branchA = ids.branch;
  const branchB = id(12);
  const packingA = ids.packing;
  const packingB = id(13);
  let activeBranchId = branchA;
  let selectedPackingId: string | null = packingA;
  let mutationSequence = 0;
  let operationCounter = 0;
  let visiblePacking = "packing-a-before-mutation";
  const executedOperationIds: string[] = [];

  async function runMutation(input: {
    branchId: string;
    packingId: string;
    expectedVersion: number;
    payload: unknown;
    request: Promise<string>;
  }): Promise<boolean> {
    const token = coordinator.beginRequest();
    if (token === null) return false;
    const sequence = ++mutationSequence;
    const fingerprint = createPackingOperationFingerprint({
      action: "save-preparation",
      branchId: input.branchId,
      packingId: input.packingId,
      expectedVersion: input.expectedVersion,
      payload: input.payload,
    });
    const operationId = coordinator.getOrCreateOperationId(
      fingerprint,
      () => `operation-${++operationCounter}`,
    );
    executedOperationIds.push(operationId);
    try {
      const responsePacking = await input.request;
      coordinator.markOperationDefinitive(fingerprint);
      if (isCurrentPackingRequest({
        sequence,
        currentSequence: mutationSequence,
        requestedBranchId: input.branchId,
        activeBranchId,
        requestedPackingId: input.packingId,
        selectedPackingId,
      })) {
        visiblePacking = responsePacking;
      }
      return true;
    } catch {
      return false;
    } finally {
      coordinator.finishRequest(token);
    }
  }

  const delayedA = deferred<string>();
  const mutationA = runMutation({
    branchId: branchA,
    packingId: packingA,
    expectedVersion: 3,
    payload: { totalWeight: 2.125, packageCount: 1 },
    request: delayedA.promise,
  });
  await Promise.resolve();
  assert.equal(coordinator.isRequestInFlight(), true);

  // El provider privado conserva esta misma instancia aunque la pagina se desmonte y remonte.
  const remountedCoordinator = sessionScope.coordinator;
  activeBranchId = branchB;
  selectedPackingId = packingB;
  mutationSequence += 1;
  visiblePacking = "packing-b";
  assert.equal(remountedCoordinator.beginRequest(), null);
  assert.equal(await runMutation({
    branchId: branchB,
    packingId: packingB,
    expectedVersion: 1,
    payload: { totalWeight: 1, packageCount: 1 },
    request: Promise.resolve("packing-b-first-attempt"),
  }), false);
  assert.equal(executedOperationIds.length, 1);

  delayedA.resolve("packing-a-late-response");
  await mutationA;
  assert.equal(visiblePacking, "packing-b");
  assert.equal(coordinator.isRequestInFlight(), false);

  assert.equal(await runMutation({
    branchId: branchB,
    packingId: packingB,
    expectedVersion: 1,
    payload: { totalWeight: 1, packageCount: 1 },
    request: Promise.resolve("packing-b-after-release"),
  }), true);
  assert.equal(visiblePacking, "packing-b-after-release");
  assert.equal(executedOperationIds.length, 2);

  const uncertainPayload = { totalWeight: 2, packageCount: 1 };
  assert.equal(await runMutation({
    branchId: branchB,
    packingId: packingB,
    expectedVersion: 2,
    payload: uncertainPayload,
    request: Promise.reject(new TypeError("network")),
  }), false);
  const uncertainOperationId = executedOperationIds.at(-1);
  assert.equal(coordinator.isRequestInFlight(), false);
  assert.equal(await runMutation({
    branchId: branchB,
    packingId: packingB,
    expectedVersion: 2,
    payload: uncertainPayload,
    request: Promise.resolve("packing-b-retry"),
  }), true);
  assert.equal(executedOperationIds.at(-1), uncertainOperationId);

  const staleToken = coordinator.beginRequest();
  assert.notEqual(staleToken, null);
  assert.equal(coordinator.finishRequest(staleToken!), true);
  const currentToken = coordinator.beginRequest();
  assert.notEqual(currentToken, null);
  assert.equal(coordinator.finishRequest(staleToken!), false);
  assert.equal(coordinator.isRequestInFlight(), true);
  assert.equal(coordinator.finishRequest(currentToken!), true);

  // Una sesion nueva recibe otro coordinador y nunca hereda locks ni identidades anteriores.
  const nextSessionCoordinator = new PackingMutationSessionScope({
    sessionId: "session-b", userId: ids.user, tenantId: ids.tenant,
  }).coordinator;
  const nextSessionToken = nextSessionCoordinator.beginRequest();
  assert.notEqual(nextSessionToken, null);
  assert.equal(nextSessionCoordinator.finishRequest(nextSessionToken!), true);
}

function verifyOperationIdentityRetention() {
  assert.equal(shouldRetainPackingOperationIdentity(new BackendRequestError("network", 0)), true);
  assert.equal(shouldRetainPackingOperationIdentity(new BackendRequestError("timeout", 408)), true);
  assert.equal(shouldRetainPackingOperationIdentity(new BackendRequestError("server", 500)), true);
  assert.equal(shouldRetainPackingOperationIdentity(new TypeError("invalid response")), true);
  assert.equal(shouldRetainPackingOperationIdentity(new BackendRequestError("validation", 400)), false);
  assert.equal(shouldRetainPackingOperationIdentity(
    new BackendRequestError("conflict", 409, "PACKING_VERSION_CONFLICT"),
  ), false);

  let nextId = 0;
  const createId = () => `retained-${++nextId}`;
  const uncertain = new PackingMutationCoordinator(2);
  const fingerprintA = createPackingOperationFingerprint({
    action: "save", branchId: ids.branch, packingId: ids.packing, expectedVersion: 1,
  });
  const fingerprintB = createPackingOperationFingerprint({
    action: "label", branchId: ids.branch, packingId: ids.packing, expectedVersion: 1,
  });
  const fingerprintC = createPackingOperationFingerprint({
    action: "finalize", branchId: ids.branch, packingId: ids.packing, expectedVersion: 1,
  });
  const firstId = uncertain.getOrCreateOperationId(fingerprintA, createId);
  assert.equal(uncertain.getOrCreateOperationId(fingerprintA, createId), firstId);
  uncertain.getOrCreateOperationId(fingerprintB, createId);
  uncertain.getOrCreateOperationId(fingerprintC, createId);
  assert.equal(uncertain.retainedOperationCount(), 2);
  assert.notEqual(uncertain.getOrCreateOperationId(fingerprintA, createId), firstId);
  assert.equal(uncertain.retainedOperationCount(), 2);

  const definitive = new PackingMutationCoordinator();
  const definitiveId = definitive.getOrCreateOperationId(fingerprintA, createId);
  definitive.markOperationDefinitive(fingerprintA);
  assert.notEqual(definitive.getOrCreateOperationId(fingerprintA, createId), definitiveId);
}

async function verifyCompositeMutationContextInvalidation() {
  const branchA = ids.branch;
  const branchB = id(12);
  let activeBranchId = branchA;
  let selectedPackingId: string | null = ids.packing;
  let currentSequence = 1;
  let finalizeContinuationApplied = false;
  const delayedReload = deferred<void>();

  const finalizeContinuation = (async () => {
    await delayedReload.promise;
    if (!isCurrentPackingRequest({
      sequence: 1,
      currentSequence,
      requestedBranchId: branchA,
      activeBranchId,
      requestedPackingId: ids.packing,
      selectedPackingId,
    })) return false;
    finalizeContinuationApplied = true;
    return true;
  })();

  // Equivale a la invalidacion sincronica del useLayoutEffect del hook.
  activeBranchId = branchB;
  selectedPackingId = id(13);
  currentSequence += 1;
  delayedReload.resolve();
  assert.equal(await finalizeContinuation, false);
  assert.equal(finalizeContinuationApplied, false);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function verifyBlockedPrintDoesNotRegister() {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { open: () => null },
  });
  try {
    const dto = toPackingDetailDto(parseApiPackingDetail(detailResponse));
    assert.equal(printPackingLabel(dto), false);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

void main();
