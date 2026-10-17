import assert from "node:assert/strict";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import {
  InventoryAdjustmentType,
  InventoryTransferStatus,
  PurchaseOrderStatus,
  ReceiptLineStatus,
  ReceiptStatus,
  SerialStatus,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { fromBaseQuantity, toBaseQuantity } from "@/core/units";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockInventoryAdjustmentRepository,
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockCategoryRepository,
  MockInventoryRepository,
  MockInventoryTransferRepository,
  MockInventoryTransferRequestRepository,
  MockDispatchRepository,
  MockPackingRepository,
  MockPickingRepository,
  MockOrderRepository,
  MockCustomerRepository,
  MockIncidentTypeRepository,
  MockPlanRepository,
  MockProductRepository,
  MockProductSalesPriceTierRepository,
  MockProductMediaRepository,
  MockProductKitComponentRepository,
  MockPromotionRepository,
  MockPurchaseOrderRepository,
  MockReceiptRepository,
  MockRoleRepository,
  MockSupplierProductRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { RegisterInventoryAdjustmentService } from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";
import { GetPosProductsService } from "@/modules/pos/application/services/GetPosProductsService";
import { GetStorefrontDiscoveryService } from "@/modules/storefront/application/services/GetStorefrontDiscoveryService";
import { GetInventoryAlertsService } from "@/modules/inventory/application/services/GetInventoryAlertsService";
import { CreateInventoryTransferService } from "@/modules/inventory/application/services/InventoryTransferServices";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";
import { PackingApplicationService } from "@/modules/logistics/application/services/PackingApplicationService";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { ReceivingDocumentDetailService } from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import {
  validateLines,
} from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import type {
  ReceivingDocumentDetail,
  ReceivingDocumentLine,
} from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();
  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }
  override set<T>(key: string, value: T) {
    this.values.set(key, JSON.stringify(value));
  }
  override remove(key: string) {
    this.values.delete(key);
  }
}

const store = new MockDatabaseStore(new MemoryStorageAdapter());
const events = new DataEventBus();
const purchaseOrders = new MockPurchaseOrderRepository(store, events);
const receipts = new MockReceiptRepository(store, events);
const adjustments = new MockInventoryAdjustmentRepository(store, events);
const repositories = {
  auth: {
    getCurrentSessionId: async () => "session-inventory-traceability",
    getSession: async (sessionId: string) =>
      sessionId === "session-inventory-traceability"
        ? { id: sessionId, userId: "user-inventory" }
        : null,
  },
  users: new MockUserRepository(store, events),
  roles: new MockRoleRepository(store, events),
  tenants: new MockTenantRepository(store, events),
  products: new MockProductRepository(store, events),
  productSalesPriceTiers: new MockProductSalesPriceTierRepository(store, events),
  inventory: new MockInventoryRepository(store, events),
  inventoryAdjustments: adjustments,
  supplierProducts: new MockSupplierProductRepository(store, events),
  units: new MockUnitRepository(store, events),
  productKitComponents: new MockProductKitComponentRepository(store, events),
  promotions: new MockPromotionRepository(store, events),
  businessConfig: new MockBusinessConfigRepository(store, events),
  categories: new MockCategoryRepository(store, events),
  productMedia: new MockProductMediaRepository(store, events),
  branches: new MockBranchRepository(store, events),
  inventoryTransferRequests: new MockInventoryTransferRequestRepository(store, events),
  plans: new MockPlanRepository(store, events),
  tenantSubscriptions: new MockTenantSubscriptionRepository(store, events),
} as unknown as RepositoryRegistry;
const adjustmentService = new RegisterInventoryAdjustmentService(repositories);

async function verifyPurchaseOrderReceivingStatus() {
  let sequence = 0;
  const createOrder = async (items: Array<{ productId: string; quantity: number }>) => {
    sequence += 1;
    return purchaseOrders.create({
      tenantId: "tenant-demo",
      branchId: "branch-centro",
      supplierId: "supplier-tools",
      status: PurchaseOrderStatus.approved,
      subtotal: items.reduce((sum, item) => sum + item.quantity, 0),
      total: items.reduce((sum, item) => sum + item.quantity, 0),
      createdByUserId: "user-admin",
      items: items.map((item) => ({
        ...item,
        unitId: "unit-unit",
        purchaseToBaseFactor: 1,
        unitCost: 1,
        subtotal: item.quantity,
      })),
    });
  };
  const confirm = async (
    purchaseOrderId: string,
    suffix: string,
    lines: Parameters<MockReceiptRepository["confirmReceiptInventory"]>[0]["lines"],
    incidents: Parameters<MockReceiptRepository["confirmReceiptInventory"]>[0]["incidents"] = [],
  ) => {
    const receipt = await receipts.create({
      tenantId: "tenant-demo",
      branchId: "branch-centro",
      number: `REC-STATUS-${suffix}`,
      purchaseOrderId,
      supplierId: "supplier-tools",
      status: ReceiptStatus.in_progress,
      receivedByUserId: "user-admin",
    });
    const input = {
      tenantId: "tenant-demo",
      receiptId: receipt.id,
      confirmationId: `confirm-status-${suffix}`,
      confirmationFingerprint: `status-${suffix}`,
      receivedByUserId: "user-admin",
      receivedAt: `2026-09-17T12:${String(sequence).padStart(2, "0")}:00.000Z`,
      incidents,
      lines,
    };
    return { receipt: await receipts.confirmReceiptInventory(input), input };
  };
  const line = (productId: string, orderedQuantity: number, receivedQuantity: number, inventoryQuantity = receivedQuantity) => ({
    productId,
    orderedQuantity,
    receivedQuantity,
    inventoryQuantity,
    rejectedQuantity: Math.max(0, orderedQuantity - receivedQuantity),
    status: receivedQuantity >= orderedQuantity ? ReceiptLineStatus.complete : ReceiptLineStatus.partial,
    locationId: "loc-centro-a",
  });

  const singleOrder = await createOrder([{ productId: "prod-screws", quantity: 10 }]);
  const single = await confirm(singleOrder.id, "single", [line("prod-screws", 10, 10)]);
  assert.equal((await purchaseOrders.getById(singleOrder.id))?.status, PurchaseOrderStatus.received);
  const singleMovements = store.getSnapshot().inventoryMovements.filter(
    (item) => item.referenceType === "receipt" && item.referenceId === single.receipt.id,
  );
  await receipts.confirmReceiptInventory(single.input);
  assert.equal(
    store.getSnapshot().inventoryMovements.filter(
      (item) => item.referenceType === "receipt" && item.referenceId === single.receipt.id,
    ).length,
    singleMovements.length,
    "reconfirming the same receipt must not post inventory twice",
  );

  const splitOrder = await createOrder([{ productId: "prod-screws", quantity: 10 }]);
  await confirm(splitOrder.id, "split-1", [line("prod-screws", 10, 4)]);
  assert.equal((await purchaseOrders.getById(splitOrder.id))?.status, PurchaseOrderStatus.partially_received);
  await confirm(splitOrder.id, "split-2", [line("prod-screws", 6, 6)]);
  assert.equal((await purchaseOrders.getById(splitOrder.id))?.status, PurchaseOrderStatus.received);

  const multiCompleteOrder = await createOrder([
    { productId: "prod-screws", quantity: 3 },
    { productId: "prod-screws", quantity: 7 },
  ]);
  await confirm(multiCompleteOrder.id, "multi-complete", [
    line("prod-screws", 3, 3),
    line("prod-screws", 7, 7),
  ]);
  assert.equal((await purchaseOrders.getById(multiCompleteOrder.id))?.status, PurchaseOrderStatus.received);

  const multiPartialOrder = await createOrder([
    { productId: "prod-screws", quantity: 3 },
    { productId: "prod-screws", quantity: 7 },
  ]);
  await confirm(multiPartialOrder.id, "multi-partial", [
    line("prod-screws", 3, 3),
    line("prod-screws", 7, 6),
  ]);
  assert.equal(
    (await purchaseOrders.getById(multiPartialOrder.id))?.status,
    PurchaseOrderStatus.partially_received,
  );

  const incidentOrder = await createOrder([{ productId: "prod-screws", quantity: 10 }]);
  await confirm(
    incidentOrder.id,
    "incident",
    [line("prod-screws", 10, 10, 9)],
    [{
      productId: "prod-screws",
      incidentTypeId: "incident-damaged",
      description: "Una unidad dañada, documentada sin alterar la cantidad recibida.",
      quantityAffected: 1,
      createdByUserId: "user-admin",
    }],
  );
  assert.equal((await purchaseOrders.getById(incidentOrder.id))?.status, PurchaseOrderStatus.received);
}

async function verifyTransferReceipt(kind: "plain" | "lot" | "multi_lot" | "serial", partial: boolean) {
  const transferStorage = new MemoryStorageAdapter();
  const transferStore = new MockDatabaseStore(transferStorage);
  const productId = `receipt-${kind}-${partial ? "partial" : "full"}`;
  const serials = Array.from({ length: 5 }, (_, index) => `RECEIPT-${kind}-${index + 1}`);
  transferStore.transact((db) => {
    const template = db.products.find((entry) => entry.id === "prod-screws");
    assert.ok(template);
    const admin = db.users.find((entry) => entry.id === "user-admin");
    assert.ok(admin);
    db.users.push({ ...admin, id: `foreign-${productId}`, tenantId: "tenant-foreign" });
    db.products.push({ ...template, id: productId, sku: productId,
      tracking: { stock: true, lot: kind !== "plain", expiration: kind !== "plain",
        serial: kind === "serial" } });
    db.inventoryBalances.push({ id: `${productId}-balance`, tenantId: "tenant-demo",
      branchId: "branch-centro", productId, locationId: "loc-centro-a",
      quantity: 5, reservedQuantity: 0, updatedAt: new Date().toISOString() });
    if (kind !== "plain") {
      db.stockLots.push({ id: `${productId}-lot`, tenantId: "tenant-demo",
        branchId: "branch-centro", productId, locationId: "loc-centro-a",
        lotNumber: "L-001", expirationDate: "2030-04-30T00:00:00.000Z",
        quantity: kind === "multi_lot" ? 3 : 5, createdAt: new Date().toISOString() });
    }
    if (kind === "multi_lot") {
      db.stockLots.push({ id: `${productId}-lot-next`, tenantId: "tenant-demo",
        branchId: "branch-centro", productId, locationId: "loc-centro-a",
        lotNumber: "L-002", expirationDate: "2031-04-30T00:00:00.000Z",
        quantity: 2, createdAt: new Date().toISOString() });
    }
    if (kind === "serial") serials.forEach((serialNumber, index) => {
      db.serialNumbers.push({ id: `${productId}-serial-${index}`, tenantId: "tenant-demo",
        branchId: "branch-centro", productId, locationId: "loc-centro-a",
        lotId: `${productId}-lot`, serialNumber, status: SerialStatus.available,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
  });
  const transferEvents = new DataEventBus();
  let activeBranchId = "branch-norte";
  const auth = { getCurrentSessionId: async () => "receipt-transfer-session",
    getSession: async () => ({ id: "receipt-transfer-session", userId: "user-admin",
      activeBranchId, createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z", rememberMe: false }) };
  const repo = {
    auth,
    branches: new MockBranchRepository(transferStore, transferEvents),
    businessConfig: new MockBusinessConfigRepository(transferStore, transferEvents),
    categories: new MockCategoryRepository(transferStore, transferEvents),
    customers: new MockCustomerRepository(transferStore, transferEvents),
    dispatches: new MockDispatchRepository(transferStore, transferEvents),
    incidentTypes: new MockIncidentTypeRepository(transferStore, transferEvents),
    inventory: new MockInventoryRepository(transferStore, transferEvents),
    inventoryTransfers: new MockInventoryTransferRepository(transferStore, transferEvents),
    inventoryTransferRequests: new MockInventoryTransferRequestRepository(transferStore, transferEvents),
    orders: new MockOrderRepository(transferStore, transferEvents),
    packings: new MockPackingRepository(transferStore, transferEvents),
    picking: new MockPickingRepository(transferStore, transferEvents),
    plans: new MockPlanRepository(transferStore, transferEvents),
    products: new MockProductRepository(transferStore, transferEvents),
    productKitComponents: new MockProductKitComponentRepository(transferStore, transferEvents),
    purchaseOrders: new MockPurchaseOrderRepository(transferStore, transferEvents),
    receipts: new MockReceiptRepository(transferStore, transferEvents),
    roles: new MockRoleRepository(transferStore, transferEvents),
    supplierProducts: new MockSupplierProductRepository(transferStore, transferEvents),
    tenants: new MockTenantRepository(transferStore, transferEvents),
    tenantSubscriptions: new MockTenantSubscriptionRepository(transferStore, transferEvents),
    units: new MockUnitRepository(transferStore, transferEvents),
    users: new MockUserRepository(transferStore, transferEvents),
  } as unknown as RepositoryRegistry;
  const created = await new CreateInventoryTransferService(repo).execute({
    destinationBranchId: "branch-norte", sourceBranchId: "branch-centro", productId,
    quantity: 5, operationId: `receipt-create-${productId}`,
  });
  const transferId = created.transfer.id;
  activeBranchId = "branch-centro";
  const picking = new PickingApplicationService(repo);
  const pickingOrder = transferStore.getSnapshot().pickingOrders.find((entry) =>
    entry.sourceType === "transfer" && entry.sourceId === transferId);
  assert.ok(pickingOrder);
  await picking.assign("branch-centro", pickingOrder.id);
  const pickingLine = (await picking.getDetail("branch-centro", pickingOrder.id)).lines[0];
  await picking.updateLine("branch-centro", { pickingOrderId: pickingOrder.id,
    pickingLineId: pickingLine.pickingLineId, pickedQuantity: 5,
    serialNumbers: kind === "serial" ? serials : undefined,
    operationId: `receipt-pick-${productId}` });
  await picking.complete("branch-centro", pickingOrder.id);
  const packing = new PackingApplicationService(repo);
  const packingOrder = transferStore.getSnapshot().packings.find((entry) =>
    entry.sourceType === "transfer" && entry.sourceId === transferId);
  assert.ok(packingOrder);
  let packingDetail = await packing.getDetail("branch-centro", packingOrder.id);
  packingDetail = (await packing.savePreparation("branch-centro", {
    packingId: packingOrder.id, operationId: `receipt-prepare-${productId}`,
    expectedVersion: packingDetail.version,
    checklist: { packageProtectionChecked: true, documentIncludedChecked: true,
      recipientVerifiedChecked: true }, totalWeight: 1, packageCount: 1,
  })).packing;
  packingDetail = (await packing.generateLabel("branch-centro", {
    packingId: packingOrder.id, operationId: `receipt-label-${productId}`,
    expectedVersion: packingDetail.version,
  })).packing;
  packingDetail = (await packing.registerLabelPrint("branch-centro", {
    packingId: packingOrder.id, operationId: `receipt-print-${productId}`,
    expectedVersion: packingDetail.version,
    labelGenerationId: packingDetail.labelGenerationId!,
  })).packing;
  await packing.finalize("branch-centro", { packingId: packingOrder.id,
    operationId: `receipt-finalize-${productId}`, expectedVersion: packingDetail.version });
  await new DispatchApplicationService(repo).confirmTransfer("branch-centro", transferId,
    `receipt-dispatch-${productId}`);
  activeBranchId = "branch-norte";
  const receiving = new ReceivingDocumentDetailService(repo);
  const detail = await receiving.getDocument("transfer", transferId, "branch-norte");
  assert.equal(detail.readOnly, false);
  if (kind === "multi_lot") {
    assert.equal(detail.lines.length, 2);
    const firstLot = detail.lines.find((entry) => entry.lotNumber === "L-001");
    const nextLot = detail.lines.find((entry) => entry.lotNumber === "L-002");
    assert.equal(firstLot?.orderedQuantity, 3);
    assert.equal(nextLot?.orderedQuantity, 2);
    assert.ok(firstLot);
    await receiving.confirm({ documentType: "transfer", documentId: transferId,
      confirmationId: `receipt-multi-first-${productId}`, incidents: [],
      lines: [{ ...firstLot, receivedNow: 2, locationId: "loc-norte-a" }] });
    const pending = await receiving.getDocument("transfer", transferId, "branch-norte");
    assert.equal(pending.lines.find((entry) => entry.lotNumber === "L-001")?.pendingQuantity, 1);
    assert.equal(pending.lines.find((entry) => entry.lotNumber === "L-002")?.pendingQuantity, 2);
    await receiving.confirm({ documentType: "transfer", documentId: transferId,
      confirmationId: `receipt-multi-second-${productId}`, incidents: [],
      lines: pending.lines.map((entry) => ({ ...entry, receivedNow: entry.pendingQuantity,
        locationId: "loc-norte-a" })) });
    const final = transferStore.getSnapshot();
    assert.equal(final.inventoryTransfers.find((entry) => entry.id === transferId)?.status,
      InventoryTransferStatus.received);
    assert.deepEqual(final.stockLots.filter((entry) => entry.productId === productId &&
      entry.branchId === "branch-norte").map((entry) => [entry.lotNumber, entry.quantity]).sort(),
    [["L-001", 3], ["L-002", 2]]);
    return;
  }
  assert.equal(detail.lines.length, 1);
  const line = detail.lines[0];
  if (kind !== "plain") {
    assert.equal(line.lotNumber, "L-001");
    assert.equal(line.expirationDate, "2030-04-30");
  }
  if (kind === "serial") {
    assert.deepEqual(line.serialNumbersText.split("\n"), serials);
    assert.equal(line.receivedNow, 0);
  }
  const firstQuantity = partial ? 3 : 5;
  const firstLine = { ...line, locationId: "loc-norte-a", receivedNow: firstQuantity,
    serialNumbersText: kind === "serial" ? serials.slice(0, firstQuantity).join("\n") : "" };
  const command = { documentType: "transfer" as const, documentId: transferId,
    lines: [firstLine], incidents: [], confirmationId: `receipt-first-${productId}` };
  activeBranchId = "branch-centro";
  await assert.rejects(receiving.confirm({ ...command, confirmationId: `wrong-branch-${productId}` }),
    /sucursal destino debe estar activa/i);
  activeBranchId = "branch-norte";
  await assert.rejects(repo.inventoryTransfers.markReceived(transferId, {
    receivedByUserId: `foreign-${productId}`, confirmationId: `foreign-${productId}`,
    items: [{ itemId: created.items[0].id, receivedQuantity: 1,
      locationId: "loc-norte-a", lotNumber: line.lotNumber,
      expirationDate: line.expirationDate,
      serialNumbers: kind === "serial" ? [serials[0]] : [] }],
  }), /actor is not active in tenant/);
  await receiving.confirm(command);
  await receiving.confirm(command);
  const afterFirst = transferStore.getSnapshot();
  const destinationQuantity = () => transferStore.getSnapshot().inventoryBalances
    .filter((entry) => entry.productId === productId && entry.branchId === "branch-norte")
    .reduce((sum, entry) => sum + entry.quantity, 0);
  assert.equal(destinationQuantity(), firstQuantity);
  assert.equal(afterFirst.inventoryTransfers.find((entry) => entry.id === transferId)?.status,
    partial ? InventoryTransferStatus.inTransit : InventoryTransferStatus.received);
  if (kind !== "plain") {
    assert.equal(afterFirst.stockLots.find((entry) => entry.productId === productId &&
      entry.branchId === "branch-norte")?.quantity, firstQuantity);
  }
  if (partial) {
    const pending = await receiving.getDocument("transfer", transferId, "branch-norte");
    assert.equal(pending.lines[0].acceptedPreviously, 3);
    assert.equal(pending.lines[0].pendingQuantity, 2);
    if (kind === "serial") {
      assert.deepEqual(pending.lines[0].serialNumbersText.split("\n"), serials.slice(3));
      await assert.rejects(receiving.confirm({ ...command,
        confirmationId: `duplicate-serial-${productId}`,
        lines: [{ ...pending.lines[0], locationId: "loc-norte-a", receivedNow: 1,
          serialNumbersText: serials[0] }],
      }), /serial was not dispatched or was already received/);
      await assert.rejects(receiving.confirm({ ...command,
        confirmationId: `foreign-serial-${productId}`,
        lines: [{ ...pending.lines[0], locationId: "loc-norte-a", receivedNow: 1,
          serialNumbersText: "S99" }],
      }), /serial was not dispatched or was already received/);
    }
    await receiving.confirm({ ...command, confirmationId: `receipt-second-${productId}`,
      lines: [{ ...pending.lines[0], locationId: "loc-norte-a", receivedNow: 2,
        serialNumbersText: kind === "serial" ? serials.slice(3).join("\n") : "" }] });
    assert.equal(destinationQuantity(), 5);
    assert.equal(transferStore.getSnapshot().inventoryTransfers.find((entry) => entry.id === transferId)
      ?.status, InventoryTransferStatus.received);
  }
  if (kind !== "plain") {
    const destinationLots = transferStore.getSnapshot().stockLots.filter((entry) =>
      entry.productId === productId && entry.branchId === "branch-norte");
    assert.equal(destinationLots.length, 1);
    assert.equal(destinationLots[0].lotNumber, "L-001");
    assert.equal(destinationLots[0].expirationDate, "2030-04-30T00:00:00.000Z");
    assert.equal(destinationLots[0].quantity, 5);
  }
  if (kind === "serial") {
    const completed = await receiving.getDocument("transfer", transferId, "branch-norte");
    assert.equal(completed.readOnly, true);
    assert.deepEqual(completed.lines[0].serialNumbersText.split("\n"), serials);
    const destinationSerials = transferStore.getSnapshot().serialNumbers.filter((entry) =>
      entry.productId === productId && entry.branchId === "branch-norte");
    assert.deepEqual(destinationSerials.map((entry) => entry.serialNumber).sort(), serials);
    assert.ok(destinationSerials.every((entry) => entry.status === SerialStatus.available));
    assert.equal(transferStore.getSnapshot().serialNumbers.filter((entry) =>
      entry.productId === productId).length, 5);
  }
  assert.equal(transferStore.getSnapshot().inventoryMovements.filter((entry) =>
    entry.referenceType === "transfer" && entry.referenceId === transferId &&
    entry.branchId === "branch-norte" && entry.type === "in")
    .reduce((sum, entry) => sum + entry.quantity, 0), 5);
}

async function main() {
  await verifyPurchaseOrderReceivingStatus();
  // Regression: product metadata persists across an account/session switch,
  // while stock remains strictly branch-scoped. The adjustment below is the
  // real application service; POS is queried through its normal read model.
  const persistenceProductId = "prod-branch-persistence-harness";
  let persistenceUnitId = "";
  store.mutate((db) => {
    const template = db.products.find((item) => item.id === "prod-screws");
    assert.ok(template);
    persistenceUnitId = template.baseUnitId;
    db.products.push({
      ...template,
      id: persistenceProductId,
      sku: "BRANCH-PERSIST-10",
      name: "Producto persistencia sucursal",
      tracking: { stock: true, lot: false, expiration: false, serial: false },
      channels: { pos: true, ecommerce: false, mobileApp: false },
    });
  });
  await adjustmentService.execute({
    productId: persistenceProductId,
    branchId: "branch-centro",
    locationId: "loc-centro-a",
    unitId: persistenceUnitId,
    movementKind: "in",
    quantity: 10,
    reason: "Existencia inicial de regresión",
    notes: "",
  });
  const persistedProduct = store.getSnapshot().products.find((item) => item.id === persistenceProductId);
  assert.ok(persistedProduct, "Product metadata survives session/account changes");
  const branchAProduct = (await new GetPosProductsService(repositories).execute({
    tenantId: "tenant-demo", branchId: "branch-centro",
  })).find((item) => item.productId === persistenceProductId);
  const branchBProduct = (await new GetPosProductsService(repositories).execute({
    tenantId: "tenant-demo", branchId: "branch-norte",
  })).find((item) => item.productId === persistenceProductId);
  assert.equal(branchAProduct?.availableQuantity, 10, "Branch A stock persists");
  assert.equal(branchAProduct?.isAvailableForSale, true, "Branch A follows normal POS availability");
  assert.equal(branchBProduct?.availableQuantity, 0, "Branch B cannot consume Branch A stock");
  assert.equal(branchBProduct?.isAvailableForSale, false, "Branch B remains unsellable at zero stock");

  const receivingDetail = {
    capabilities: {
      supportsInventory: true,
      supportsLots: true,
      supportsExpiration: true,
      supportsSerials: true,
      supportsMultipleLocations: true,
      supportsUnitsAndPackaging: true,
    },
    lines: [{ id: "expiration-line", unitAllowsDecimals: false }],
    incidentTypes: [],
  } as unknown as ReceivingDocumentDetail;
  const receivingLine = {
    id: "expiration-line",
    productId: "expiration-product",
    productName: "Producto con vencimiento",
    orderedQuantity: 1,
    acceptedPreviously: 0,
    receivedNow: 1,
    locationId: "loc-centro-a",
    lotNumber: "LOT-EXP",
    expirationDate: "2026-09-14",
    serialNumbersText: "",
    tracking: { stock: true, lot: true, expiration: true, serial: false },
  } as ReceivingDocumentLine;
  assert.match(
    validateLines([receivingLine], [], receivingDetail, "2026-09-15T10:00:00.000Z")[0] ?? "",
    /no puede ser anterior/,
  );
  assert.equal(
    validateLines(
      [{ ...receivingLine, expirationDate: "2026-09-15" }],
      [],
      receivingDetail,
      "2026-09-15T10:00:00.000Z",
    ).length,
    0,
  );

  store.mutate((db) => {
    const normalProduct = db.products.find((item) => item.id === "prod-screws");
    assert.ok(normalProduct);
    db.products.push({
      ...normalProduct,
      id: "prod-lot-harness",
      sku: "LOT-HARNESS",
      tracking: { stock: true, lot: true, expiration: true, serial: false },
    });
    db.supplierProducts.push({
      id: "supplier-product-harness",
      tenantId: "tenant-demo",
      supplierId: "supplier-tools",
      productId: "prod-drill",
      purchaseUnitId: "unit-box",
      purchaseToBaseFactor: 5,
      lastCost: 100,
      leadTimeDays: 1,
      minimumOrderQuantity: 1,
      preferred: false,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
  const order = await purchaseOrders.create({
    tenantId: "tenant-demo",
    branchId: "branch-centro",
    supplierId: "supplier-tools",
    status: PurchaseOrderStatus.approved,
    subtotal: 600,
    total: 600,
    createdByUserId: "user-admin",
    items: [
      {
        productId: "prod-drill",
        quantity: 5,
        unitId: "unit-box",
        purchaseToBaseFactor: 5,
        unitCost: 100,
        subtotal: 600,
      },
    ],
  });
  assert.equal(order.items?.[0]?.purchaseToBaseFactor, 5);
  assert.equal(
    (order.items?.[0]?.quantity ?? 0) * (order.items?.[0]?.purchaseToBaseFactor ?? 0),
    25,
  );

  store.mutate((db) => {
    const association = db.supplierProducts.find((item) => item.id === "supplier-product-harness");
    assert.ok(association);
    association.purchaseToBaseFactor = 12;
  });
  assert.equal((await purchaseOrders.getById(order.id))?.items?.[0]?.purchaseToBaseFactor, 5);

  const receipt = await receipts.create({
    tenantId: "tenant-demo",
    branchId: "branch-centro",
    number: "REC-SNAPSHOT",
    purchaseOrderId: order.id,
    supplierId: "supplier-tools",
    status: ReceiptStatus.in_progress,
    receivedByUserId: "user-admin",
  });
  const serials = Array.from({ length: 25 }, (_, index) => `SN-RECEIPT-${index + 1}`);
  await receipts.confirmReceiptInventory({
    tenantId: "tenant-demo",
    receiptId: receipt.id,
    confirmationId: "confirm-snapshot",
    confirmationFingerprint: "snapshot-10",
    receivedByUserId: "user-admin",
    receivedAt: new Date().toISOString(),
    incidents: [],
    lines: [
      {
        productId: "prod-drill",
        orderedQuantity: 5,
        receivedQuantity: 5,
        inventoryQuantity: 25,
        rejectedQuantity: 0,
        status: ReceiptLineStatus.partial,
        locationId: "loc-centro-b",
        serialNumbers: serials,
      },
    ],
  });
  const confirmedLine = (await receipts.getLinesByReceipt(receipt.id))[0];
  assert.equal(confirmedLine.inventoryQuantity, 25);
  assert.equal(confirmedLine.serialNumbers?.length, 25);

  const duplicateReceipt = await receipts.create({
    tenantId: "tenant-demo",
    branchId: "branch-centro",
    number: "REC-DUPLICATE",
    purchaseOrderId: order.id,
    supplierId: "supplier-tools",
    status: ReceiptStatus.in_progress,
  });
  await assert.rejects(
    () =>
      receipts.confirmReceiptInventory({
        tenantId: "tenant-demo",
        receiptId: duplicateReceipt.id,
        confirmationId: "confirm-duplicate",
        confirmationFingerprint: "duplicate",
        receivedByUserId: "user-admin",
        receivedAt: new Date().toISOString(),
        incidents: [],
        lines: [
          {
            productId: "prod-drill",
            orderedQuantity: 6,
            receivedQuantity: 0.2,
            inventoryQuantity: 2,
            rejectedQuantity: 0,
            status: ReceiptLineStatus.partial,
            locationId: "loc-centro-b",
            serialNumbers: ["SN-DUPLICATE", "SN-DUPLICATE"],
          },
        ],
      }),
    /Duplicate serial number/,
  );

  const drillBefore = store
    .getSnapshot()
    .inventoryBalances.filter(
      (item) => item.productId === "prod-drill" && item.branchId === "branch-centro",
    )
    .reduce((sum, item) => sum + item.quantity, 0);
  await assert.rejects(
    () =>
      adjustments.registerStockAdjustment({
        tenantId: "tenant-demo",
        branchId: "branch-centro",
        productId: "prod-drill",
        locationId: "loc-centro-b",
        type: InventoryAdjustmentType.manualIncrease,
        reason: "Missing serials",
        quantityBefore: drillBefore,
        quantityAfter: drillBefore + 10,
      }),
    /Exactly 10 unique serial numbers/,
  );
  const adjustmentSerials = Array.from({ length: 10 }, (_, index) => `SN-ADJUST-${index + 1}`);
  const positive = await adjustments.registerStockAdjustment({
    tenantId: "tenant-demo",
    branchId: "branch-centro",
    productId: "prod-drill",
    locationId: "loc-centro-b",
    type: InventoryAdjustmentType.manualIncrease,
    reason: "Manual serial entry",
    quantityBefore: drillBefore,
    quantityAfter: drillBefore + 10,
    serialNumbers: adjustmentSerials,
  });
  assert.equal(positive.movements.length, 10);

  const adhesiveBefore = store
    .getSnapshot()
    .inventoryBalances.filter(
      (item) => item.productId === "prod-lot-harness" && item.branchId === "branch-centro",
    )
    .reduce((sum, item) => sum + item.quantity, 0);
  await assert.rejects(
    () =>
      adjustments.registerStockAdjustment({
        tenantId: "tenant-demo",
        branchId: "branch-centro",
        productId: "prod-lot-harness",
        locationId: "loc-centro-a",
        type: InventoryAdjustmentType.manualIncrease,
        reason: "Missing trace",
        quantityBefore: adhesiveBefore,
        quantityAfter: adhesiveBefore + 2,
      }),
    /Lot number is required/,
  );
  const lotAdjustment = await adjustments.registerStockAdjustment({
    tenantId: "tenant-demo",
    branchId: "branch-centro",
    productId: "prod-lot-harness",
    locationId: "loc-centro-a",
    type: InventoryAdjustmentType.manualIncrease,
    reason: "Lot entry",
    quantityBefore: adhesiveBefore,
    quantityAfter: adhesiveBefore + 2,
    lotNumber: "LOT-HARNESS",
    expirationDate: "2027-12-31",
  });
  assert.equal(lotAdjustment.movements[0]?.quantity, 2);
  const lotProduct = store.getSnapshot().products.find((item) => item.id === "prod-lot-harness");
  assert.ok(lotProduct);
  await assert.rejects(
    () => adjustmentService.execute({
      productId: lotProduct.id,
      branchId: "branch-centro",
      locationId: "loc-centro-a",
      unitId: lotProduct.baseUnitId,
      movementKind: "in",
      quantity: 1,
      reason: "Fecha anterior",
      notes: "",
      lotNumber: "LOT-PAST",
      expirationDate: "2000-01-01",
    }),
    /no puede ser anterior/,
  );
  const historicalLot = store
    .getSnapshot()
    .stockLots.find((item) => item.productId === lotProduct.id && item.lotNumber === "LOT-HARNESS");
  assert.ok(historicalLot);
  store.mutate((db) => {
    const lot = db.stockLots.find((item) => item.id === historicalLot.id);
    assert.ok(lot);
    lot.expirationDate = "2000-01-01";
  });
  await adjustmentService.execute({
    productId: lotProduct.id,
    branchId: "branch-centro",
    locationId: "loc-centro-a",
    unitId: lotProduct.baseUnitId,
    movementKind: "out",
    quantity: 1,
    reason: "Consumir lote historico vencido",
    notes: "",
    lotId: historicalLot.id,
  });
  await assert.rejects(
    () =>
      adjustments.registerStockAdjustment({
        tenantId: "tenant-demo",
        branchId: "branch-centro",
        productId: "prod-lot-harness",
        locationId: "loc-centro-a",
        type: InventoryAdjustmentType.manualDecrease,
        reason: "Unknown lot",
        quantityBefore: adhesiveBefore + 1,
        quantityAfter: adhesiveBefore,
        lotId: "missing-lot",
      }),
    /Selected lot is not available/,
  );
  await assert.rejects(
    () =>
      adjustments.registerStockAdjustment({
        tenantId: "tenant-demo",
        branchId: "branch-centro",
        productId: "prod-drill",
        locationId: "loc-centro-b",
        type: InventoryAdjustmentType.manualDecrease,
        reason: "Unknown serial",
        quantityBefore: drillBefore + 10,
        quantityAfter: drillBefore + 9,
        serialNumbers: ["UNKNOWN-SERIAL"],
      }),
    /not available in this location/,
  );

  const screwsBefore = store
    .getSnapshot()
    .inventoryBalances.filter(
      (item) => item.productId === "prod-screws" && item.branchId === "branch-centro",
    )
    .reduce((sum, item) => sum + item.quantity, 0);
  const normal = await adjustments.registerStockAdjustment({
    tenantId: "tenant-demo",
    branchId: "branch-centro",
    productId: "prod-screws",
    locationId: "loc-centro-a",
    type: InventoryAdjustmentType.manualIncrease,
    reason: "Normal product",
    quantityBefore: screwsBefore,
    quantityAfter: screwsBefore + 3,
  });
  assert.equal(normal.movements[0]?.quantity, 3);

  store.mutate((db) => {
    const screws = db.products.find((item) => item.id === "prod-screws");
    assert.ok(screws);
    screws.baseUnitId = "unit-unit";
    screws.saleUnitId = "unit-unit";
    screws.inventoryUnitId = "unit-box";
    db.unitConversions = db.unitConversions.filter((item) => item.productId !== screws.id);
    db.unitConversions.push({
      id: "conversion-harness-box-five",
      tenantId: screws.tenantId,
      productId: screws.id,
      fromUnitId: "unit-box",
      toUnitId: "unit-unit",
      factor: 5,
      createdAt: new Date().toISOString(),
    });
    db.supplierProducts = db.supplierProducts.filter((item) => item.productId !== screws.id);
    db.inventoryBalances
      .filter((item) => item.productId === screws.id && item.branchId === "branch-centro")
      .forEach((balance, index) => {
        balance.quantity = index === 0 ? 11 : 0;
        balance.reservedQuantity = 0;
      });
  });
  const conversions = await repositories.units.getConversionsByProductScoped(
    "tenant-demo",
    "prod-screws",
  );
  assert.equal(
    fromBaseQuantity(11, {
      targetUnitId: "unit-box",
      baseUnitId: "unit-unit",
      conversions,
    }),
    2.2,
  );
  store.mutate((db) => {
    const conversion = db.unitConversions.find((item) => item.id === "conversion-harness-box-five");
    assert.ok(conversion);
    conversion.factor = 10;
  });
  const inventoryData = await new GetInventoryAlertsService(repositories).execute("branch-centro");
  const inventoryScrews = inventoryData.rows.find((item) => item.productId === "prod-screws");
  assert.equal(inventoryScrews?.quantity, 11);
  assert.equal(inventoryScrews?.inventoryPresentationQuantity, 1.1);
  assert.notEqual(inventoryScrews?.inventoryUnitId, inventoryScrews?.unitId);
  store.mutate((db) => {
    const screws = db.products.find((item) => item.id === "prod-screws");
    assert.ok(screws);
    screws.inventoryUnitId = screws.baseUnitId;
  });
  const singleUnitInventory = await new GetInventoryAlertsService(repositories).execute(
    "branch-centro",
  );
  const singleUnitScrews = singleUnitInventory.rows.find((item) => item.productId === "prod-screws");
  assert.equal(singleUnitScrews?.inventoryUnitId, singleUnitScrews?.unitId);
  store.mutate((db) => {
    const screws = db.products.find((item) => item.id === "prod-screws");
    assert.ok(screws);
    screws.inventoryUnitId = "unit-box";
  });
  await adjustmentService.execute({
    productId: "prod-screws",
    branchId: "branch-centro",
    locationId: "loc-centro-a",
    unitId: "unit-box",
    movementKind: "in",
    quantity: 1,
    reason: "Caja x10",
    notes: "",
  });
  await adjustmentService.execute({
    productId: "prod-screws",
    branchId: "branch-centro",
    locationId: "loc-centro-a",
    unitId: "unit-unit",
    movementKind: "in",
    quantity: 1,
    reason: "Unidad base",
    notes: "",
  });
  await adjustmentService.execute({
    productId: "prod-screws",
    branchId: "branch-centro",
    locationId: "loc-centro-a",
    unitId: "unit-box",
    movementKind: "out",
    quantity: 1,
    reason: "Salida caja x10",
    notes: "",
  });
  const screwsAfterConversions = store.getSnapshot().inventoryBalances
    .filter((item) => item.productId === "prod-screws" && item.branchId === "branch-centro")
    .reduce((sum, item) => sum + item.quantity, 0);
  assert.equal(screwsAfterConversions, 12);
  store.mutate((db) => {
    const screws = db.products.find((item) => item.id === "prod-screws");
    assert.ok(screws);
    screws.saleUnitId = "unit-box";
  });
  const posProducts = await new GetPosProductsService(repositories).execute({
    tenantId: "tenant-demo",
    branchId: "branch-centro",
  });
  const posScrews = posProducts.find((item) => item.productId === "prod-screws");
  assert.equal(posScrews?.availableQuantity, 1.2);
  assert.equal(posScrews?.saleUnitId, "unit-box");
  const storefront = await new GetStorefrontDiscoveryService(repositories).execute(publicStorefrontSlug, "tenant-demo");
  const storefrontScrews = storefront.products.find((item) => item.id === "prod-screws");
  assert.equal(storefrontScrews?.availableQuantity, 1.2);
  assert.equal(storefrontScrews?.saleUnitId, "unit-box");

  store.mutate((db) => {
    const drill = db.products.find((item) => item.id === "prod-drill");
    assert.ok(drill);
    drill.baseUnitId = "unit-unit";
    drill.inventoryUnitId = "unit-box";
    db.unitConversions = db.unitConversions.filter((item) => item.productId !== drill.id);
    db.unitConversions.push({
      id: "conversion-harness-serial-five",
      tenantId: drill.tenantId,
      productId: drill.id,
      fromUnitId: "unit-box",
      toUnitId: "unit-unit",
      factor: 5,
      createdAt: new Date().toISOString(),
    });
    db.supplierProducts = db.supplierProducts.filter((item) => item.productId !== drill.id);
  });
  const fiveSerials = Array.from({ length: 5 }, (_, index) => `SN-BOX-FIVE-${index + 1}`);
  const serialAdjustment = await adjustmentService.execute({
    productId: "prod-drill",
    branchId: "branch-centro",
    locationId: "loc-centro-b",
    unitId: "unit-box",
    movementKind: "in",
    quantity: 1,
    reason: "Caja serial x5",
    notes: "",
    serialNumbers: fiveSerials,
  });
  assert.equal(serialAdjustment.movement.quantity, 1);
  assert.equal(
    store.getSnapshot().serialNumbers.filter((item) => fiveSerials.includes(item.serialNumber)).length,
    5,
  );

  assert.throws(
    () => toBaseQuantity(1, {
      sourceUnitId: "unit-pack",
      baseUnitId: "unit-unit",
      conversions: [],
    }),
    /No existe conversion/,
  );
  assert.throws(
    () => toBaseQuantity(1, {
      sourceUnitId: "unit-box",
      baseUnitId: "unit-unit",
      conversions: [{ fromUnitId: "unit-box", toUnitId: "unit-unit", factor: 0 }],
    }),
    /mayor que cero/,
  );

  await verifyTransferReceipt("plain", false);
  await verifyTransferReceipt("lot", false);
  await verifyTransferReceipt("lot", true);
  await verifyTransferReceipt("multi_lot", true);
  await verifyTransferReceipt("serial", false);
  await verifyTransferReceipt("serial", true);
  console.log("Inventory/receiving traceability harness passed (including full and partial Transfer receipts).");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
