import assert from "node:assert/strict";
import { TransportMode } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ApiDispatchRepository } from "@/infrastructure/api/repositories/ApiDispatchRepository";
import {
  parseApiDispatchQueue,
  parseApiDispatchResult,
  parseApiPreparedDispatch,
  parseConfirmDispatchCommand,
  parseConfirmTransferDispatchCommand,
} from "@/infrastructure/api/repositories/dispatchApi.schema";
import { withApiLogisticsDispatch } from "@/infrastructure/api/withApiLogisticsDispatch";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { toPreparedDispatchDetailDto } from "@/modules/logistics/application/mappers/DispatchApiMapper";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import {
  advanceDispatchReadContext,
  captureDispatchReadContext,
  createDispatchReadContext,
  isCurrentDispatchRead,
  readCurrentDispatchContextValue,
  removeConfirmedDispatchSource,
} from "@/modules/logistics/hooks/dispatchReadIdentity";
import {
  createDispatchOperationFingerprint,
  DispatchMutationCoordinator,
  shouldRetainDispatchOperationIdentity,
} from "@/modules/logistics/hooks/dispatchRequestIdentity";
import { logisticsNavigation } from "@/modules/logistics/navigation";
import { validateDispatchShipment } from "@/modules/logistics/validation/dispatch.validation";

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = {
  branch: id(1), order: id(2), transfer: id(3), packing: id(4), picking: id(5),
  dispatch: id(6), dispatchPackage: id(7), tenant: id(8), user: id(9), role: id(10),
};

const queueResponse = [
  {
    orderId: ids.order,
    orderReference: "ORD-100",
    createdAt: "2026-10-08T14:00:00Z",
    transportMode: "third_party",
    packingId: ids.packing,
    packingFinalizedAt: "2026-10-08T15:00:00Z",
    sourceType: "order",
    sourceId: ids.order,
    sourceReference: "ORD-100",
  },
  {
    orderId: null,
    orderReference: null,
    createdAt: "2026-10-08T14:10:00Z",
    transportMode: "own_fleet",
    packingId: id(11),
    packingFinalizedAt: "2026-10-08T15:10:00Z",
    sourceType: "transfer",
    sourceId: ids.transfer,
    sourceReference: "TRF-100",
  },
] as const;

const preparedResponse = {
  orderId: ids.order,
  orderReference: "ORD-100",
  createdAt: "2026-10-08T14:00:00Z",
  orderStatus: "ready_for_dispatch",
  recipientName: "Cliente Dispatch",
  recipientPhone: null,
  deliveryAddress: { line1: "Zona 1" },
  notificationContact: null,
  transportMode: "third_party",
  pickingOrderId: ids.picking,
  pickingStatus: "completed",
  pickingCompletedAt: "2026-10-08T14:30:00Z",
  packingId: ids.packing,
  packingStatus: "finalized",
  packingFinalizedAt: "2026-10-08T15:00:00Z",
  packageCount: 2,
  totalWeight: 3.125,
  labelCode: "LBL-ORD-100",
};

const orderDispatchResponse = {
  orderId: ids.order,
  orderStatus: "dispatched",
  dispatchId: ids.dispatch,
  dispatchStatus: "dispatched",
  transportMode: "third_party",
  carrierName: "Cargo Express",
  trackingNumber: "GUIA-100",
  dispatchedAt: "2026-10-08T16:00:00Z",
  packages: [{
    id: ids.dispatchPackage,
    number: "LBL-ORD-100-1",
    weight: null,
    description: "Bulto 1 de 2",
  }],
  idempotent: false,
  sourceType: "order",
  sourceId: ids.order,
  sourceReference: "ORD-100",
  transferStatus: null,
} as const;

const transferDispatchResponse = {
  ...orderDispatchResponse,
  orderId: null,
  orderStatus: null,
  transportMode: "own_fleet",
  carrierName: null,
  trackingNumber: null,
  sourceType: "transfer",
  sourceId: ids.transfer,
  sourceReference: "TRF-100",
  transferStatus: "inTransit",
} as const;

async function main() {
  verifySchemasMapperAndValidation();
  await verifyStaleResponseProtection();
  await verifyMutationCoordinator();
  await verifyRoutesBodiesAndErrors();
  await verifyIdempotentReadBack();
  verifyRepositorySelection();
  verifyNavigationPermission();
  console.log("verify-api-logistics-dispatch: PASS");
}

function verifyNavigationPermission() {
  const dispatchItem = logisticsNavigation[0]?.children?.find(
    (item) => item.id === "logistics-dispatches",
  );
  assert.deepEqual(dispatchItem?.anyPermission, [
    "logistics.packing.read",
    "logistics.dispatch.read",
  ]);
}

function verifySchemasMapperAndValidation() {
  const queue = parseApiDispatchQueue(queueResponse);
  assert.equal(queue.length, 2);
  assert.equal(queue[0]?.sourceType, "order");
  assert.equal(queue[1]?.sourceType, "transfer");

  const prepared = parseApiPreparedDispatch(preparedResponse);
  assert.equal(prepared.deliveryAddress?.recipientPhone, null);
  assert.equal(prepared.deliveryAddress?.city, null);
  const dto = toPreparedDispatchDetailDto(prepared);
  assert.deepEqual(dto.notificationContact, { emailMode: "legacy_unknown" });
  assert.equal(dto.address?.line1, "Zona 1");

  assert.equal(toPreparedDispatchDetailDto(parseApiPreparedDispatch({
    ...preparedResponse,
    recipientName: null,
  })).recipientName, null);
  assert.equal(toPreparedDispatchDetailDto(parseApiPreparedDispatch({
    ...preparedResponse,
    recipientName: "Cliente Dispatch",
  })).recipientName, "Cliente Dispatch");

  assert.equal(parseApiDispatchResult(orderDispatchResponse).sourceType, "order");
  assert.equal(parseApiDispatchResult(transferDispatchResponse).transferStatus, "inTransit");
  assert.deepEqual(parseConfirmDispatchCommand({
    operationId: " op-order ",
    carrierName: " Cargo Express ",
    trackingNumber: " GUIA-100 ",
  }), {
    operationId: "op-order",
    carrierName: "Cargo Express",
    trackingNumber: "GUIA-100",
  });
  assert.deepEqual(parseConfirmTransferDispatchCommand({ operationId: " op-transfer " }), {
    operationId: "op-transfer",
  });

  assert.equal(validateDispatchShipment(TransportMode.third_party, {
    carrierName: " ", trackingNumber: " ",
  }).valid, false);
  assert.equal(validateDispatchShipment(TransportMode.third_party, {
    carrierName: "Cargo Express", trackingNumber: "GUIA-100",
  }).valid, true);
  assert.equal(validateDispatchShipment(TransportMode.own_fleet, {
    carrierName: "", trackingNumber: "",
  }).valid, true);
  assert.equal(validateDispatchShipment(TransportMode.third_party, {
    carrierName: "x".repeat(201), trackingNumber: "GUIA-100",
  }).valid, false);

  assert.throws(
    () => parseApiDispatchQueue([{ ...queueResponse[1], orderId: ids.order }]),
    (error) => error instanceof BackendRequestError && error.code === "INVALID_BACKEND_RESPONSE",
  );
  assert.throws(
    () => parseApiPreparedDispatch({ ...preparedResponse, packageCount: null }),
    (error) => error instanceof BackendRequestError && error.code === "INVALID_BACKEND_RESPONSE",
  );
  assert.throws(
    () => parseApiDispatchResult({ ...transferDispatchResponse, orderId: ids.order }),
    (error) => error instanceof BackendRequestError && error.code === "INVALID_BACKEND_RESPONSE",
  );
}

async function verifyStaleResponseProtection() {
  const contextA = "session-a:user-a:tenant-a:branch-a";
  const contextB = "session-a:user-a:tenant-a:branch-b";
  let contextState = createDispatchReadContext(contextA);
  const firstAToken = captureDispatchReadContext(contextState, contextA);
  assert.ok(firstAToken);
  const previousDetail = { ...firstAToken, value: { orderId: ids.order } };
  const previousLoading = { ...firstAToken, value: true };
  assert.equal(readCurrentDispatchContextValue(previousDetail, contextState, contextA)?.orderId, ids.order);

  let resolveDeferred!: () => void;
  const deferred = new Promise<void>((resolve) => { resolveDeferred = resolve; });
  let lateResponseApplied = false;
  const lateResponse = deferred.then(() => {
    lateResponseApplied = isCurrentDispatchRead({
      sequence: 4,
      currentSequence: 4,
      ...firstAToken,
      activeContextKey: contextState.activeContextKey,
      activeContextGeneration: contextState.generation,
      requestedOrderId: ids.order,
      selectedOrderId: ids.order,
    });
  });

  contextState = advanceDispatchReadContext(contextState, contextB);
  assert.equal(readCurrentDispatchContextValue(previousDetail, contextState, contextB), null);
  assert.equal(readCurrentDispatchContextValue(previousLoading, contextState, contextB), null);
  contextState = advanceDispatchReadContext(contextState, contextA);
  assert.equal(contextState.generation, 2);
  assert.equal(readCurrentDispatchContextValue(previousDetail, contextState, contextA), null);
  assert.equal(readCurrentDispatchContextValue(previousLoading, contextState, contextA), null);

  resolveDeferred();
  await lateResponse;
  assert.equal(lateResponseApplied, false);
  const secondAToken = captureDispatchReadContext(contextState, contextA);
  assert.ok(secondAToken);
  assert.notEqual(secondAToken.requestedContextGeneration, firstAToken.requestedContextGeneration);

  const remaining = removeConfirmedDispatchSource(parseApiDispatchQueue(queueResponse), "order", ids.order);
  assert.deepEqual(remaining.map((item) => item.sourceId), [ids.transfer]);
}

async function verifyMutationCoordinator() {
  const coordinator = new DispatchMutationCoordinator(3);
  let coordinatorNotifications = 0;
  const unsubscribe = coordinator.subscribe(() => { coordinatorNotifications += 1; });
  const base = {
    action: "confirm-order" as const,
    sessionId: "session-a",
    userId: ids.user,
    tenantId: ids.tenant,
    branchId: ids.branch,
    sourceType: "order" as const,
    sourceId: ids.order,
    payload: { carrierName: "Cargo Express", trackingNumber: "GUIA-100" },
  };
  const fingerprint = createDispatchOperationFingerprint(base);
  const token = coordinator.beginRequest();
  assert.ok(token);
  assert.equal(coordinator.beginRequest(), null, "double click must not start a second request");
  assert.equal(coordinator.finishRequest(token + 1), false, "only the owner token may unlock");
  const operationId = coordinator.getOrCreateOperationId(fingerprint, () => "operation-order");
  assert.equal(coordinator.getOrCreateOperationId(fingerprint), operationId);
  assert.equal(coordinator.finishRequest(token), true);
  assert.equal(coordinatorNotifications, 2);
  unsubscribe();

  const changedPayload = createDispatchOperationFingerprint({
    ...base,
    payload: { carrierName: "Cargo Express", trackingNumber: "GUIA-200" },
  });
  const changedBranch = createDispatchOperationFingerprint({ ...base, branchId: id(12) });
  const changedSession = createDispatchOperationFingerprint({ ...base, sessionId: "session-b" });
  const changedUser = createDispatchOperationFingerprint({ ...base, userId: id(13) });
  const changedTenant = createDispatchOperationFingerprint({ ...base, tenantId: id(14) });
  const changedSource = createDispatchOperationFingerprint({ ...base, sourceId: id(15) });
  assert.notEqual(changedPayload, fingerprint);
  assert.notEqual(changedBranch, fingerprint);
  assert.notEqual(changedSession, fingerprint);
  assert.notEqual(changedUser, fingerprint);
  assert.notEqual(changedTenant, fingerprint);
  assert.notEqual(changedSource, fingerprint);
  assert.notEqual(coordinator.getOrCreateOperationId(changedPayload, () => "operation-payload"), operationId);

  assert.equal(shouldRetainDispatchOperationIdentity(new BackendRequestError("network", 0)), true);
  assert.equal(shouldRetainDispatchOperationIdentity(new BackendRequestError("timeout", 408)), true);
  assert.equal(shouldRetainDispatchOperationIdentity(new BackendRequestError("server", 500)), true);
  assert.equal(shouldRetainDispatchOperationIdentity(new BackendRequestError("conflict", 409)), false);
  const uncertain = new DispatchMutationCoordinator();
  const uncertainFingerprint = createDispatchOperationFingerprint(base);
  const uncertainId = uncertain.getOrCreateOperationId(uncertainFingerprint, () => "operation-uncertain");
  if (!shouldRetainDispatchOperationIdentity(new BackendRequestError("server", 500))) {
    uncertain.markOperationDefinitive(uncertainFingerprint);
  }
  assert.equal(uncertain.getOrCreateOperationId(uncertainFingerprint), uncertainId);
  coordinator.markOperationDefinitive(fingerprint);
  assert.equal(coordinator.getOrCreateOperationId(fingerprint, () => "operation-new"), "operation-new");

  const lru = new DispatchMutationCoordinator(2);
  lru.getOrCreateOperationId("a", () => "a-1");
  lru.getOrCreateOperationId("b", () => "b-1");
  lru.getOrCreateOperationId("a");
  lru.getOrCreateOperationId("c", () => "c-1");
  assert.equal(lru.getOrCreateOperationId("a"), "a-1");
  assert.equal(lru.getOrCreateOperationId("b", () => "b-2"), "b-2");

  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const crossBranch = new DispatchMutationCoordinator();
  const pendingToken = crossBranch.beginRequest();
  assert.ok(pendingToken);
  const completion = pending.then(() => crossBranch.finishRequest(pendingToken));
  assert.equal(crossBranch.beginRequest(), null, "a branch change cannot bypass the active lock");
  release();
  assert.equal(await completion, true);
  assert.ok(crossBranch.beginRequest(), "the lock must be available after settlement");
}

async function verifyRoutesBodiesAndErrors() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.includes("/prepared?")) return Response.json(preparedResponse);
      if (url.includes("/transfers/")) return Response.json(transferDispatchResponse);
      if (url.includes("/confirm?")) return Response.json(orderDispatchResponse);
      if (url === `/api/backend/logistics/dispatch?branchId=${ids.branch}`) {
        return Response.json(queueResponse);
      }
      return Response.json(orderDispatchResponse);
    };
    const repository = new ApiDispatchRepository();
    const scope = { tenantId: ids.tenant, branchId: ids.branch };
    await repository.getQueue(scope);
    await repository.getPreparedDetail(scope, ids.order);
    await repository.getDetail(scope, ids.order);
    await repository.confirmOrder(scope, ids.order, {
      operationId: "operation-order",
      carrierName: "Cargo Express",
      trackingNumber: "GUIA-100",
    });
    await repository.getTransferDetail(scope, ids.transfer);
    await repository.confirmTransfer(scope, ids.transfer, { operationId: "operation-transfer" });

    assert.deepEqual(calls, [
      { url: `/api/backend/logistics/dispatch?branchId=${ids.branch}`, method: "GET", body: undefined },
      { url: `/api/backend/logistics/dispatch/${ids.order}/prepared?branchId=${ids.branch}`, method: "GET", body: undefined },
      { url: `/api/backend/logistics/dispatch/${ids.order}?branchId=${ids.branch}`, method: "GET", body: undefined },
      {
        url: `/api/backend/logistics/dispatch/${ids.order}/confirm?branchId=${ids.branch}`,
        method: "POST",
        body: {
          operationId: "operation-order",
          carrierName: "Cargo Express",
          trackingNumber: "GUIA-100",
        },
      },
      { url: `/api/backend/logistics/dispatch/transfers/${ids.transfer}?branchId=${ids.branch}`, method: "GET", body: undefined },
      {
        url: `/api/backend/logistics/dispatch/transfers/${ids.transfer}/confirm?branchId=${ids.branch}`,
        method: "POST",
        body: { operationId: "operation-transfer" },
      },
    ]);

    for (const status of [400, 401, 403, 404, 409, 500]) {
      const code = `DISPATCH_HTTP_${status}`;
      globalThis.fetch = async () => Response.json(
        { code, message: `Error ${status}.` },
        { status },
      );
      await assert.rejects(
        repository.confirmOrder(scope, ids.order, { operationId: "operation-error" }),
        (error) => error instanceof BackendRequestError && error.status === status && error.code === code,
      );
    }
    globalThis.fetch = async () => { throw new TypeError("network"); };
    await assert.rejects(
      repository.confirmTransfer(scope, ids.transfer, { operationId: "operation-timeout" }),
      (error) => error instanceof BackendRequestError && error.status === 0,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyIdempotentReadBack() {
  let orderReadBacks = 0;
  let transferReadBacks = 0;
  const orderReplay = parseApiDispatchResult({ ...orderDispatchResponse, idempotent: true });
  const transferReplay = parseApiDispatchResult({ ...transferDispatchResponse, idempotent: true });
  const repositories = {
    dispatchReadDataSource: "api",
    auth: {
      getCurrentSessionId: async () => "session-a",
      getSession: async () => ({
        id: "session-a", userId: ids.user, createdAt: "2026-10-08T12:00:00Z",
        expiresAt: "2099-10-08T12:00:00Z", rememberMe: false,
      }),
    },
    users: {
      getById: async () => ({
        id: ids.user, tenantId: ids.tenant, name: "Operador", email: "operator@example.com",
        type: "employee", status: "active", roleId: ids.role, allowedBranchIds: [ids.branch],
        createdAt: "2026-10-08T12:00:00Z", updatedAt: "2026-10-08T12:00:00Z",
      }),
    },
    roles: {
      getByIdScoped: async () => ({
        id: ids.role, tenantId: ids.tenant, name: "Logística", isSystem: false,
        permissions: ["logistics.dispatch.read", "logistics.dispatch.confirm"],
        branchScope: "selected", status: "active",
        createdAt: "2026-10-08T12:00:00Z", updatedAt: "2026-10-08T12:00:00Z",
      }),
    },
    branches: {
      getById: async () => ({
        id: ids.branch, tenantId: ids.tenant, code: "B1", name: "Central", type: "warehouse",
        status: "active", createdAt: "2026-10-08T12:00:00Z", updatedAt: "2026-10-08T12:00:00Z",
      }),
    },
    dispatchRead: {
      getDetail: async () => { orderReadBacks += 1; return orderReplay; },
      getTransferDetail: async () => { transferReadBacks += 1; return transferReplay; },
    },
    dispatchCommands: {
      confirmOrder: async () => orderReplay,
      confirmTransfer: async () => transferReplay,
    },
  } as unknown as RepositoryRegistry;
  const service = new DispatchApplicationService(repositories);
  const order = await service.confirmApiOrder(ids.branch, ids.order, { operationId: "operation-order" });
  const transfer = await service.confirmApiTransfer(
    ids.branch,
    ids.transfer,
    { operationId: "operation-transfer" },
  );
  assert.equal(order.idempotent, true);
  assert.equal(transfer.idempotent, true);
  assert.equal(orderReadBacks, 1);
  assert.equal(transferReadBacks, 1);
}

function verifyRepositorySelection() {
  let legacyDispatchCalls = 0;
  const legacyDispatches = new Proxy({}, {
    get() {
      return () => { legacyDispatchCalls += 1; };
    },
  });
  const original = {
    dispatchReadDataSource: "mock",
    dispatches: legacyDispatches,
  } as unknown as RepositoryRegistry;
  const wrapped = withApiLogisticsDispatch(original);
  assert.equal(wrapped.dispatchReadDataSource, "api");
  assert.ok(wrapped.dispatchRead instanceof ApiDispatchRepository);
  assert.equal(wrapped.dispatchCommands, wrapped.dispatchRead);
  assert.equal(wrapped.dispatches, legacyDispatches);
  assert.equal(legacyDispatchCalls, 0);
  assert.equal(original.dispatchReadDataSource, "mock");
}

void main();
