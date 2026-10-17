import assert from "node:assert/strict";
import { InventoryTransferReason, InventoryTransferStatus, SerialStatus } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";
import { MockCategoryRepository } from "@/infrastructure/mock/repositories/MockCategoryRepository";
import { MockCustomerRepository } from "@/infrastructure/mock/repositories/MockCustomerRepository";
import { MockDispatchRepository } from "@/infrastructure/mock/repositories/MockDispatchRepository";
import { MockIncidentTypeRepository } from "@/infrastructure/mock/repositories/MockIncidentTypeRepository";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { MockInventoryTransferRepository } from "@/infrastructure/mock/repositories/MockInventoryTransferRepository";
import { MockInventoryTransferRequestRepository } from "@/infrastructure/mock/repositories/MockInventoryTransferRequestRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPackingRepository } from "@/infrastructure/mock/repositories/MockPackingRepository";
import { MockPickingRepository } from "@/infrastructure/mock/repositories/MockPickingRepository";
import { MockPlanRepository } from "@/infrastructure/mock/repositories/MockPlanRepository";
import { MockProductKitComponentRepository } from "@/infrastructure/mock/repositories/MockProductKitComponentRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockPurchaseOrderRepository } from "@/infrastructure/mock/repositories/MockPurchaseOrderRepository";
import { MockReceiptRepository } from "@/infrastructure/mock/repositories/MockReceiptRepository";
import { MockRoleRepository } from "@/infrastructure/mock/repositories/MockRoleRepository";
import { MockSupplierRepository } from "@/infrastructure/mock/repositories/MockSupplierRepository";
import { MockSupplierProductRepository } from "@/infrastructure/mock/repositories/MockSupplierProductRepository";
import { MockTenantRepository } from "@/infrastructure/mock/repositories/MockTenantRepository";
import { MockTenantSubscriptionRepository } from "@/infrastructure/mock/repositories/MockTenantSubscriptionRepository";
import { MockUnitRepository } from "@/infrastructure/mock/repositories/MockUnitRepository";
import { MockUserRepository } from "@/infrastructure/mock/repositories/MockUserRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { CreateInventoryTransferService, CancelInventoryTransferService } from "@/modules/inventory/application/services/InventoryTransferServices";
import { GetInventoryAlertsService } from "@/modules/inventory/application/services/GetInventoryAlertsService";
import { GetInventoryProductTransfersService } from "@/modules/inventory/application/services/GetInventoryProductTransfersService";
import { ApproveTransferRequestService, CancelTransferRequestService, CreateTransferRequestService, RejectTransferRequestService } from "@/modules/inventory/application/services/TransferRequestServices";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { PackingApplicationService } from "@/modules/logistics/application/services/PackingApplicationService";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";
import { ReceivingDocumentDetailService } from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import { ReceivingDocumentsService } from "@/modules/receiving/application/services/ReceivingDocumentsService";

const tenantId = "tenant-demo";
const sourceBranchId = "branch-centro";
const destinationBranchId = "branch-norte";
const actorId = "user-admin";
const tracedProductId = "transfer-traced-product";

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();
  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : JSON.parse(value) as T;
  }
  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }
  override remove(key: string): void {
    this.values.delete(key);
  }
}

function fixture() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  store.transact((db) => {
    db.inventoryTransfers = [];
    db.inventoryTransferRequests = [];
    db.inventoryTransferItems = [];
    db.inventoryReservations = [];
    db.inventoryReservationConsumeOperations = [];
    db.inventoryMovements = [];
    db.pickingOrders = [];
    db.pickingItems = [];
    db.pickingItemUpdateOperations = [];
    db.pickingIncidents = [];
    db.pickingAssignmentReleases = [];
    db.packings = [];
    db.packingOperations = [];
    db.dispatches = [];
    db.packages = [];
    db.receipts = [];
    db.receiptLines = [];
    db.receiptIncidents = [];
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
      if (balance.id === "bal-screws") balance.quantity = 100;
    });
    const template = db.products.find((product) => product.id === "prod-screws");
    assert.ok(template);
    const now = new Date().toISOString();
    db.products.push({ ...template, id: tracedProductId, sku: "TRANSFER-TRACE",
      name: "Fixture traslado lote y serie",
      tracking: { stock: true, lot: true, expiration: true, serial: true } });
    db.inventoryBalances.push({ id: "transfer-traced-balance", tenantId,
      branchId: sourceBranchId, productId: tracedProductId, locationId: "loc-centro-b",
      quantity: 2, reservedQuantity: 0, updatedAt: now });
    for (const suffix of ["A", "B"]) {
      const lotId = `transfer-traced-lot-${suffix}`;
      db.stockLots.push({ id: lotId, tenantId, branchId: sourceBranchId,
        productId: tracedProductId, locationId: "loc-centro-b", lotNumber: `TRACE-${suffix}`,
        expirationDate: suffix === "A" ? "2030-01-01T00:00:00.000Z" : "2031-01-01T00:00:00.000Z",
        quantity: 1, createdAt: now });
      db.serialNumbers.push({ id: `transfer-traced-serial-${suffix}`, tenantId,
        branchId: sourceBranchId, productId: tracedProductId, locationId: "loc-centro-b",
        lotId, serialNumber: `TRANSFER-SERIAL-${suffix}`, status: SerialStatus.available,
        createdAt: now, updatedAt: now });
    }
  });
  const bus = new DataEventBus();
  const auth = {
    getCurrentSessionId: async () => "transfer-session",
    getSession: async () => ({
      id: "transfer-session", userId: actorId, createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z", rememberMe: false,
      activeBranchId: destinationBranchId,
    }),
  };
  const repositories = {
    auth,
    branches: new MockBranchRepository(store, bus),
    businessConfig: new MockBusinessConfigRepository(store, bus),
    categories: new MockCategoryRepository(store, bus),
    customers: new MockCustomerRepository(store, bus),
    dispatches: new MockDispatchRepository(store, bus),
    incidentTypes: new MockIncidentTypeRepository(store, bus),
    inventory: new MockInventoryRepository(store, bus),
    inventoryTransfers: new MockInventoryTransferRepository(store, bus),
    inventoryTransferRequests: new MockInventoryTransferRequestRepository(store, bus),
    orders: new MockOrderRepository(store, bus),
    packings: new MockPackingRepository(store, bus),
    picking: new MockPickingRepository(store, bus),
    plans: new MockPlanRepository(store, bus),
    products: new MockProductRepository(store, bus),
    productKitComponents: new MockProductKitComponentRepository(store, bus),
    purchaseOrders: new MockPurchaseOrderRepository(store, bus),
    receipts: new MockReceiptRepository(store, bus),
    roles: new MockRoleRepository(store, bus),
    suppliers: new MockSupplierRepository(store, bus),
    supplierProducts: new MockSupplierProductRepository(store, bus),
    tenants: new MockTenantRepository(store, bus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, bus),
    units: new MockUnitRepository(store, bus),
    users: new MockUserRepository(store, bus),
  } as unknown as RepositoryRegistry;
  return { store, storage, repositories, create: new CreateInventoryTransferService(repositories),
    cancel: new CancelInventoryTransferService(repositories),
    picking: new PickingApplicationService(repositories),
    packing: new PackingApplicationService(repositories),
    dispatch: new DispatchApplicationService(repositories),
    receiving: new ReceivingDocumentsService(repositories),
    receivingDetail: new ReceivingDocumentDetailService(repositories) };
}

function physicalQuantity(store: MockDatabaseStore, branchId: string, productId: string) {
  return store.getSnapshot().inventoryBalances.filter((balance) =>
    balance.tenantId === tenantId && balance.branchId === branchId &&
    balance.productId === productId).reduce((sum, balance) => sum + balance.quantity, 0);
}

async function exerciseTransfer(
  env: ReturnType<typeof fixture>, productId: string, quantity: number,
  serialNumbers: string[], suffix: string,
) {
  const sourceBefore = physicalQuantity(env.store, sourceBranchId, productId);
  const destinationBefore = physicalQuantity(env.store, destinationBranchId, productId);
  const command = { sourceBranchId, destinationBranchId, productId, quantity,
    operationId: `transfer-create-${suffix}` };
  const created = await env.create.execute(command);
  const transferId = created.transfer.id;
  assert.match(created.transfer.number, /^TR-\d{4}-\d+$/);
  assert.equal(created.transfer.tenantId, tenantId);
  assert.equal(created.transfer.status, InventoryTransferStatus.preparing);
  assert.equal((await env.create.execute(command)).transfer.id, transferId);
  const afterCreateReload = new MockDatabaseStore(env.storage);
  const reloadedTransfers = new MockInventoryTransferRepository(afterCreateReload, new DataEventBus());
  assert.equal((await reloadedTransfers.create({ tenantId, sourceBranchId,
    destinationBranchId, operationId: command.operationId, preparedByUserId: actorId,
    items: [{ productId, requestedQuantity: quantity }],
  })).transfer.id, transferId);
  const snapshot = env.store.getSnapshot();
  const pickings = snapshot.pickingOrders.filter((item) =>
    item.sourceType === "transfer" && item.sourceId === transferId);
  assert.equal(pickings.length, 1);
  assert.equal(pickings[0].orderId, undefined);
  const reservations = snapshot.inventoryReservations.filter((item) =>
    item.sourceType === "transfer" && item.sourceId === transferId);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].orderId, undefined);
  assert.equal(reservations[0].status, "active");
  assert.equal(physicalQuantity(env.store, sourceBranchId, productId), sourceBefore);
  assert.equal(physicalQuantity(env.store, destinationBranchId, productId), destinationBefore);
  await assert.rejects(env.dispatch.confirmTransfer(sourceBranchId, transferId,
    `transfer-premature-dispatch-${suffix}`), /Picking\/Packing is not ready/);
  assert.ok((await env.picking.getQueue(sourceBranchId)).some((item) =>
    item.pickingOrderId === pickings[0].id && item.orderReference === created.transfer.number));

  await env.picking.assign(sourceBranchId, pickings[0].id);
  const pickingDetail = await env.picking.getDetail(sourceBranchId, pickings[0].id);
  const [line] = pickingDetail.lines;
  assert.ok(line);
  await env.picking.updateLine(sourceBranchId, {
    pickingOrderId: pickings[0].id, pickingLineId: line.pickingLineId,
    pickedQuantity: quantity, serialNumbers: serialNumbers.length ? serialNumbers : undefined,
    operationId: `transfer-pick-${suffix}`,
  });
  await env.picking.complete(sourceBranchId, pickings[0].id);
  assert.equal(physicalQuantity(env.store, sourceBranchId, productId), sourceBefore);
  const packing = env.store.getSnapshot().packings.find((item) =>
    item.sourceType === "transfer" && item.sourceId === transferId);
  assert.ok(packing);
  assert.equal(packing.orderId, undefined);
  let packingDetail = await env.packing.getDetail(sourceBranchId, packing.id);
  assert.equal(packingDetail.orderReference, created.transfer.number);
  const saved = await env.packing.savePreparation(sourceBranchId, {
    packingId: packing.id, operationId: `transfer-prep-${suffix}`,
    expectedVersion: packingDetail.version,
    checklist: { packageProtectionChecked: true, documentIncludedChecked: true,
      recipientVerifiedChecked: true }, totalWeight: 1, packageCount: 1,
  });
  packingDetail = saved.packing;
  const generated = await env.packing.generateLabel(sourceBranchId, {
    packingId: packing.id, operationId: `transfer-label-${suffix}`,
    expectedVersion: packingDetail.version,
  });
  packingDetail = generated.packing;
  assert.ok(packingDetail.labelGenerationId);
  const printed = await env.packing.registerLabelPrint(sourceBranchId, {
    packingId: packing.id, operationId: `transfer-print-${suffix}`,
    expectedVersion: packingDetail.version,
    labelGenerationId: packingDetail.labelGenerationId,
  });
  packingDetail = printed.packing;
  await env.packing.finalize(sourceBranchId, {
    packingId: packing.id, operationId: `transfer-finalize-${suffix}`,
    expectedVersion: packingDetail.version,
  });
  assert.equal(physicalQuantity(env.store, sourceBranchId, productId), sourceBefore);
  assert.equal(physicalQuantity(env.store, destinationBranchId, productId), destinationBefore);
  assert.ok((await env.dispatch.getTransferQueue(sourceBranchId)).some((item) =>
    item.transferId === transferId));

  await env.dispatch.confirmTransfer(sourceBranchId, transferId, `transfer-dispatch-${suffix}`);
  const dispatched = await env.dispatch.confirmTransfer(
    sourceBranchId, transferId, `transfer-dispatch-${suffix}`);
  assert.equal(dispatched.transfer.status, InventoryTransferStatus.inTransit);
  assert.equal(physicalQuantity(env.store, sourceBranchId, productId), sourceBefore - quantity);
  assert.equal(physicalQuantity(env.store, destinationBranchId, productId), destinationBefore);
  const afterDispatch = env.store.getSnapshot();
  await assert.rejects(env.cancel.execute(transferId, "No disponible",
    `transfer-cancel-after-dispatch-${suffix}`), /Cannot cancel/);
  assert.equal(afterDispatch.dispatches.filter((item) => item.sourceId === transferId).length, 1);
  assert.equal(afterDispatch.dispatches.find((item) => item.sourceId === transferId)?.orderId, undefined);
  assert.equal(afterDispatch.inventoryMovements.filter((item) =>
    item.referenceType === "transfer" && item.referenceId === transferId &&
    item.type === "out").reduce((sum, item) => sum + item.quantity, 0), quantity);
  assert.ok(afterDispatch.inventoryReservations.filter((item) =>
    item.sourceId === transferId).every((item) => item.status === "consumed"));
  for (const serialNumber of serialNumbers) {
    const serial = afterDispatch.serialNumbers.find((item) => item.serialNumber === serialNumber);
    assert.ok(serial);
    assert.equal(serial.status, SerialStatus.in_transit);
    assert.equal(serial.branchId, sourceBranchId);
  }

  const discovery = await env.receiving.execute(destinationBranchId);
  assert.ok(discovery.documents.some((item) => item.documentId === transferId &&
    item.documentNumber === created.transfer.number));
  const detail = await env.receivingDetail.getDocument("transfer", transferId, destinationBranchId);
  assert.equal(detail.readOnly, false);
  const confirmation = { documentType: "transfer" as const, documentId: transferId,
    confirmationId: `transfer-receipt-${suffix}`, incidents: [],
    lines: detail.lines.map((item) => ({ ...item, locationId: "loc-norte-a",
      receivedNow: item.orderedQuantity })) };
  await assert.rejects(env.receivingDetail.confirm({ ...confirmation,
    confirmationId: `transfer-invalid-receipt-${suffix}`,
    lines: confirmation.lines.map((line) => ({ ...line, locationId: "loc-centro-a" })),
  }), /destination location is unavailable/);
  assert.equal(physicalQuantity(env.store, destinationBranchId, productId), destinationBefore);
  assert.equal(env.store.getSnapshot().receipts.filter((item) =>
    item.inventoryTransferId === transferId).length, 0);
  await env.receivingDetail.confirm(confirmation);
  await env.receivingDetail.confirm(confirmation);
  await env.dispatch.confirmTransfer(sourceBranchId, transferId, `transfer-dispatch-${suffix}`);
  assert.equal((await env.packing.finalize(sourceBranchId, {
    packingId: packing.id, operationId: `transfer-finalize-${suffix}`,
    expectedVersion: packingDetail.version,
  })).idempotent, true);
  const afterReceipt = env.store.getSnapshot();
  assert.equal(physicalQuantity(env.store, destinationBranchId, productId),
    destinationBefore + quantity);
  assert.equal(afterReceipt.inventoryTransfers.find((item) => item.id === transferId)?.status,
    InventoryTransferStatus.received);
  assert.equal(afterReceipt.receipts.filter((item) => item.inventoryTransferId === transferId).length, 1);
  assert.equal(afterReceipt.inventoryMovements.filter((item) =>
    item.referenceType === "transfer" && item.referenceId === transferId &&
    item.type === "in").reduce((sum, item) => sum + item.quantity, 0), quantity);
  for (const serialNumber of serialNumbers) {
    const before = afterDispatch.serialNumbers.find((item) => item.serialNumber === serialNumber);
    const serial = afterReceipt.serialNumbers.find((item) => item.id === before?.id);
    assert.ok(serial);
    assert.equal(serial.status, SerialStatus.available);
    assert.equal(serial.branchId, destinationBranchId);
    const sourceLot = afterDispatch.stockLots.find((item) => item.id === before?.lotId);
    const destinationLot = afterReceipt.stockLots.find((item) => item.id === serial.lotId);
    if (sourceLot) {
      assert.equal(destinationLot?.lotNumber, sourceLot.lotNumber);
      assert.equal(destinationLot?.expirationDate, sourceLot.expirationDate);
    }
  }
  const afterReceiptReload = new MockDatabaseStore(env.storage).getSnapshot();
  assert.equal(afterReceiptReload.inventoryTransfers.find((item) => item.id === transferId)?.status,
    InventoryTransferStatus.received);
  assert.equal(afterReceiptReload.receipts.filter((item) =>
    item.inventoryTransferId === transferId).length, 1);
  for (const serialNumber of serialNumbers) {
    const serial = afterReceiptReload.serialNumbers.find((item) =>
      item.serialNumber === serialNumber);
    assert.equal(serial?.status, SerialStatus.available);
    assert.equal(serial?.branchId, destinationBranchId);
  }
  return created;
}

async function exerciseTransferRequests() {
  const env = fixture();
  const withActiveBranch = (branchId: string, sessionId = "transfer-session"): RepositoryRegistry => ({
    ...env.repositories,
    auth: {
      ...env.repositories.auth,
      getCurrentSessionId: async () => sessionId,
      getSession: async () => ({
        id: sessionId, userId: actorId,
        createdAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z", rememberMe: false,
        activeBranchId: branchId,
      }),
    },
  } as RepositoryRegistry);
  const requester = withActiveBranch(destinationBranchId);
  const provider = withActiveBranch(sourceBranchId);
  const requestInput = (suffix: string, quantity = 2) => ({
    productId: "prod-screws", requesterBranchId: destinationBranchId,
    providerBranchId: sourceBranchId, quantity,
    reason: InventoryTransferReason.replenishment,
    notes: suffix,
  });
  const counts = () => {
    const db = env.store.getSnapshot();
    return { transfers: db.inventoryTransfers.length,
      reservations: db.inventoryReservations.length,
      pickings: db.pickingOrders.length };
  };
  const requested = await new CreateTransferRequestService(requester).execute(requestInput("accept"));
  assert.equal(requested.status, "requested");
  assert.deepEqual(counts(), { transfers: 0, reservations: 0, pickings: 0 });
  assert.ok((await new GetInventoryAlertsService(provider).execute(sourceBranchId))
    .transferRequests.some((row) => row.id === requested.id && row.context === "received"));
  const pendingView = await new GetInventoryProductTransfersService(requester)
    .execute(destinationBranchId, "prod-screws");
  assert.equal(pendingView.requests.find((row) => row.id === requested.id)?.linkedTransferNumber,
    undefined);
  assert.equal(pendingView.requests.find((row) => row.id === requested.id)?.canCancel, true);
  assert.equal(pendingView.transfers.length, 0);
  assert.ok((await new GetInventoryProductTransfersService(provider)
    .execute(sourceBranchId, "prod-screws")).requests.some((row) =>
      row.id === requested.id && row.canReview && !row.canCancel));
  assert.equal((await new GetInventoryProductTransfersService(requester)
    .execute(destinationBranchId, tracedProductId)).requests.length, 0);

  const withdrawn = await new CreateTransferRequestService(requester)
    .execute(requestInput("withdraw"));
  await assert.rejects(new CancelTransferRequestService(provider).execute(withdrawn.id),
    /sucursal solicitante debe estar activa/);
  await assert.rejects(new CancelTransferRequestService(withActiveBranch("branch-other"))
    .execute(withdrawn.id), /sucursal solicitante debe estar activa/);
  assert.equal((await new CancelTransferRequestService(requester).execute(withdrawn.id)).status,
    "cancelled");
  assert.deepEqual(counts(), { transfers: 0, reservations: 0, pickings: 0 });
  await assert.rejects(new ApproveTransferRequestService(provider).execute(withdrawn.id),
    /not reviewable/);

  const rejectedRequest = await new CreateTransferRequestService(requester)
    .execute(requestInput("reject"));
  assert.equal((await new RejectTransferRequestService(provider)
    .execute(rejectedRequest.id, "Sin disponibilidad")).status, "rejected");
  assert.deepEqual(counts(), { transfers: 0, reservations: 0, pickings: 0 });
  await assert.rejects(new ApproveTransferRequestService(provider).execute(rejectedRequest.id),
    /not reviewable/);

  await assert.rejects(new ApproveTransferRequestService(requester).execute(requested.id),
    /sucursal proveedora debe estar activa/);
  env.store.transact((db) => {
    db.inventoryTransferRequests.push({ ...requested, id: "foreign-transfer-request",
      tenantId: "tenant-foreign" });
  });
  await assert.rejects(new ApproveTransferRequestService(provider)
    .execute("foreign-transfer-request"), /no encontrada/);
  await assert.rejects(new CancelTransferRequestService(requester)
    .execute("foreign-transfer-request"), /no encontrada/);
  assert.equal((await new GetInventoryProductTransfersService(requester)
    .execute(destinationBranchId, "prod-screws")).requests.some((row) =>
      row.id === "foreign-transfer-request"), false);
  await assert.rejects(new GetInventoryProductTransfersService(provider)
    .execute("branch-other", "prod-screws"), /sucursal seleccionada|no est/i);

  const sourceBefore = physicalQuantity(env.store, sourceBranchId, "prod-screws");
  const accepted = await new ApproveTransferRequestService(provider).execute(requested.id,
    "request-accept-first");
  assert.match(accepted.number, /^TR-\d{4}-\d+$/);
  assert.deepEqual(accepted.sourceRequestIds, [requested.id]);
  assert.equal(accepted.sourceBranchId, requested.sourceBranchId);
  assert.equal(accepted.destinationBranchId, requested.requestingBranchId);
  assert.equal(accepted.reason, requested.reason);
  const afterAccept = env.store.getSnapshot();
  const transferItems = afterAccept.inventoryTransferItems.filter((item) =>
    item.transferId === accepted.id);
  assert.equal(transferItems.length, 1);
  assert.equal(transferItems[0].productId, requested.productId);
  assert.equal(transferItems[0].requestedQuantity, requested.requestedQuantity);
  assert.equal(transferItems[0].sourceRequestId, requested.id);
  assert.equal(afterAccept.inventoryTransferRequests.find((item) =>
    item.id === requested.id)?.status, "approved");
  assert.deepEqual(counts(), { transfers: 1, reservations: 1, pickings: 1 });
  assert.equal(afterAccept.pickingOrders[0].branchId, sourceBranchId);
  assert.equal(afterAccept.pickingOrders[0].sourceId, accepted.id);
  assert.equal(physicalQuantity(env.store, sourceBranchId, "prod-screws"), sourceBefore);
  assert.equal(afterAccept.inventoryReservations[0].status, "active");
  const materializedView = await new GetInventoryProductTransfersService(requester)
    .execute(destinationBranchId, "prod-screws");
  assert.equal(materializedView.requests.find((row) => row.id === requested.id)
    ?.linkedTransferNumber, accepted.number);
  assert.equal(materializedView.requests.find((row) => row.id === requested.id)?.canCancel, false);
  assert.equal(materializedView.transfers.find((row) => row.id === accepted.id)
    ?.requestedQuantity, requested.requestedQuantity);
  assert.deepEqual(materializedView.transfers.find((row) => row.id === accepted.id)
    ?.sourceRequestIds, [requested.id]);
  await assert.rejects(new CancelTransferRequestService(requester).execute(requested.id),
    /Solo puede cancelarse/);
  await assert.rejects(env.repositories.inventoryTransferRequests.cancelRequest(requested.id),
    /Cannot cancel/);
  assert.equal((await new GetInventoryAlertsService(provider).execute(sourceBranchId))
    .transferRequests.some((row) => row.id === requested.id), false);
  assert.ok((await new GetInventoryAlertsService(requester).execute(destinationBranchId))
    .transferRequests.some((row) => row.id === requested.id && row.status === "approved"));
  const reloaded = new MockDatabaseStore(env.storage).getSnapshot();
  assert.deepEqual(reloaded.inventoryTransfers[0].sourceRequestIds, [requested.id]);

  const retry = new ApproveTransferRequestService(provider);
  assert.equal((await retry.execute(requested.id, "request-accept-first")).id, accepted.id);
  assert.equal((await retry.execute(requested.id, "request-accept-second")).id, accepted.id);
  assert.deepEqual(counts(), { transfers: 1, reservations: 1, pickings: 1 });
  const racedRequest = await new CreateTransferRequestService(requester)
    .execute(requestInput("race"));
  const raced = await Promise.all([
    retry.execute(racedRequest.id, "race-first"),
    new ApproveTransferRequestService(withActiveBranch(sourceBranchId, "second-session"))
      .execute(racedRequest.id, "race-second"),
  ]);
  assert.equal(raced[0].id, raced[1].id);
  assert.deepEqual(counts(), { transfers: 2, reservations: 2, pickings: 2 });

  const raceRequest = await new CreateTransferRequestService(requester)
    .execute(requestInput("accept-vs-cancel"));
  const race = await Promise.allSettled([
    new ApproveTransferRequestService(provider).execute(raceRequest.id, "race-accept-cancel"),
    new CancelTransferRequestService(requester).execute(raceRequest.id),
  ]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  const racedStatus = env.store.getSnapshot().inventoryTransferRequests.find((item) =>
    item.id === raceRequest.id)?.status;
  const racedTransfer = env.store.getSnapshot().inventoryTransfers.find((item) =>
    item.sourceRequestIds?.includes(raceRequest.id));
  assert.equal(racedStatus === "cancelled" && Boolean(racedTransfer), false);
  assert.equal(racedStatus === "approved", Boolean(racedTransfer));

  const cancelledTransfer = await new CancelInventoryTransferService(provider)
    .execute(accepted.id, "Prueba de cancelación", "cancel-materialized-transfer");
  assert.equal(cancelledTransfer.transfer.status, InventoryTransferStatus.cancelled);
  const countsBeforeInsufficient = counts();

  await assert.rejects(new CreateTransferRequestService(requester)
    .execute(requestInput("insufficient", sourceBefore + 1)), /stock disponible/i);
  assert.deepEqual(counts(), countsBeforeInsufficient);

  const tracedRequest = await new CreateTransferRequestService(requester).execute({
    ...requestInput("other-product", 1), productId: tracedProductId,
  });
  const tracedTransfer = await new ApproveTransferRequestService(provider)
    .execute(tracedRequest.id);
  const plainProductView = await new GetInventoryProductTransfersService(requester)
    .execute(destinationBranchId, "prod-screws");
  assert.equal(plainProductView.requests.some((row) => row.id === tracedRequest.id), false);
  assert.equal(plainProductView.transfers.some((row) => row.id === tracedTransfer.id), false);
}

async function exerciseReservedTransferAvailability() {
  const env = fixture();
  env.store.transact((db) => {
    const balance = db.inventoryBalances.find((item) => item.id === "bal-screws");
    assert.ok(balance);
    balance.quantity = 45;
    balance.reservedQuantity = 40;
    db.inventoryBalances.push({
      ...balance, id: "foreign-reservation-balance", tenantId: "tenant-foreign",
      quantity: 100, reservedQuantity: 100,
    });
  });
  const requester = { ...env.repositories, auth: {
    ...env.repositories.auth,
    getSession: async () => ({ id: "transfer-session", userId: actorId,
      createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
      rememberMe: false, activeBranchId: destinationBranchId }),
  } } as RepositoryRegistry;
  const sourceRow = (await new GetInventoryAlertsService(requester).execute(destinationBranchId))
    .rows.find((row) => row.productId === "prod-screws");
  assert.ok(sourceRow);
  assert.equal(sourceRow.otherBranchStocks.find((stock) => stock.branchId === sourceBranchId)
    ?.availableQuantity, 5);
  const input = (quantity: number) => ({ productId: "prod-screws",
    requesterBranchId: destinationBranchId, providerBranchId: sourceBranchId,
    quantity, reason: InventoryTransferReason.replenishment, notes: "availability" });
  const request = await new CreateTransferRequestService(requester).execute(input(5));
  assert.equal(request.requestedQuantity, 5);
  await assert.rejects(new CreateTransferRequestService(requester).execute(input(6)),
    /stock disponible/i);
  env.store.transact((db) => {
    const balance = db.inventoryBalances.find((item) => item.id === "bal-screws");
    assert.ok(balance);
    balance.reservedQuantity = 41;
  });
  const provider = { ...env.repositories, auth: {
    ...env.repositories.auth,
    getSession: async () => ({ id: "transfer-session", userId: actorId,
      createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
      rememberMe: false, activeBranchId: sourceBranchId }),
  } } as RepositoryRegistry;
  await assert.rejects(new ApproveTransferRequestService(provider).execute(request.id),
    /stock disponible/i);
  assert.equal(env.store.getSnapshot().inventoryTransfers.length, 0);
  assert.equal(env.store.getSnapshot().inventoryTransferRequests.find((item) => item.id === request.id)
    ?.status, "requested");
}

async function main() {
  await exerciseReservedTransferAvailability();
  await exerciseTransferRequests();
  const env = fixture();
  await assert.rejects(env.create.execute({ sourceBranchId: destinationBranchId,
    destinationBranchId: "branch-centro", productId: "prod-screws", quantity: 1,
    operationId: "wrong-active-destination" }), /sucursal activa/);
  await exerciseTransfer(env, "prod-screws", 2, [], "plain");
  await exerciseTransfer(env, tracedProductId, 2,
    ["TRANSFER-SERIAL-A", "TRANSFER-SERIAL-B"], "trace");
  await assert.rejects(env.create.execute({ sourceBranchId, destinationBranchId: sourceBranchId,
    productId: "prod-screws", quantity: 1, operationId: "same-branch" }), /distintas/);
  const foreign = env.store.getSnapshot().branches.find((branch) => branch.id === destinationBranchId);
  assert.ok(foreign);
  env.store.transact((db) => { db.branches.push({ ...foreign, id: "branch-foreign",
    tenantId: "tenant-foreign", code: "FOREIGN" }); });
  await assert.rejects(env.create.execute({ sourceBranchId: "branch-foreign",
    destinationBranchId, productId: "prod-screws", quantity: 1,
    operationId: "cross-tenant" }), /sucursal seleccionada/);
  env.store.transact((db) => {
    const role = db.roles.find((item) => item.id === "role-cashier");
    assert.ok(role);
    role.permissions = role.permissions.filter((permission) =>
      permission !== "inventory.transfers.manage");
  });
  const unauthorizedRepositories = { ...env.repositories, auth: {
    getCurrentSessionId: async () => "cashier-session",
    getSession: async () => ({ id: "cashier-session", userId: "user-cashier",
      createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z", rememberMe: false }),
  } } as unknown as RepositoryRegistry;
  await assert.rejects(new CreateInventoryTransferService(unauthorizedRepositories).execute({
    sourceBranchId, destinationBranchId, productId: "prod-screws", quantity: 1,
    operationId: "unauthorized",
  }), /permiso/);
  const sourceBeforeCancel = physicalQuantity(env.store, sourceBranchId, "prod-screws");
  const toCancel = await env.create.execute({ sourceBranchId, destinationBranchId,
    productId: "prod-screws", quantity: 1, operationId: "cancel-create" });
  const cancelPicking = env.store.getSnapshot().pickingOrders.find((item) =>
    item.sourceId === toCancel.transfer.id);
  assert.ok(cancelPicking);
  await env.picking.assign(sourceBranchId, cancelPicking.id);
  const cancelLine = (await env.picking.getDetail(sourceBranchId, cancelPicking.id)).lines[0];
  await env.picking.updateLine(sourceBranchId, { pickingOrderId: cancelPicking.id,
    pickingLineId: cancelLine.pickingLineId, pickedQuantity: 1,
    operationId: "cancel-pick" });
  await env.cancel.execute(toCancel.transfer.id, "No se enviará", "cancel-operation");
  assert.equal(physicalQuantity(env.store, sourceBranchId, "prod-screws"), sourceBeforeCancel);
  assert.ok(env.store.getSnapshot().inventoryReservations.filter((item) =>
    item.sourceId === toCancel.transfer.id).every((item) => item.status === "released"));
  assert.equal(env.store.getSnapshot().pickingItems.find((item) =>
    item.pickingOrderId === cancelPicking.id)?.pickedQuantity, 0);
  await env.cancel.execute(toCancel.transfer.id, "No se enviará", "cancel-operation");
  assert.equal(new MockDatabaseStore(env.storage).getSnapshot().inventoryTransfers.find((item) =>
    item.id === toCancel.transfer.id)?.cancelOperationId, "cancel-operation");
  await assert.rejects(env.cancel.execute(toCancel.transfer.id, "Otro motivo", "cancel-again"),
    /retry conflict/);
  const legacy = await env.create.execute({ sourceBranchId, destinationBranchId,
    productId: "prod-screws", quantity: 1, operationId: "legacy-without-dispatch" });
  env.store.transact((db) => {
    const transfer = db.inventoryTransfers.find((item) => item.id === legacy.transfer.id);
    assert.ok(transfer);
    transfer.status = InventoryTransferStatus.inTransit;
    const item = db.inventoryTransferItems.find((entry) => entry.transferId === transfer.id);
    assert.ok(item);
    item.dispatchedQuantity = 1;
  });
  const legacyDetail = await env.receivingDetail.getDocument(
    "transfer", legacy.transfer.id, destinationBranchId);
  assert.equal(legacyDetail.readOnly, true);
  await assert.rejects(env.receivingDetail.confirm({ documentType: "transfer",
    documentId: legacy.transfer.id, confirmationId: "legacy-receipt",
    lines: [], incidents: [] }), /despacho verificable/);
  console.log("verify-inter-branch-transfer: PASS");
  console.log("Create/reservation/exactly-one-Picking, Picking/Packing no stock-out, Dispatch/Receipt once, in-transit, destination, lot/serial continuity, scope, authorization and cancellation: PASS");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
