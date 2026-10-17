import { InventoryMovementType, ProductStatus, ProductType } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockInventoryRepository,
  MockOrderRepository,
  MockProductRepository,
} from "@/infrastructure/mock/repositories";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";

export async function runDemoScenario() {
  const store = new MockDatabaseStore(new LocalStorageAdapter());
  const eventBus = new DataEventBus();
  const products = new MockProductRepository(store, eventBus);
  const orders = new MockOrderRepository(store, eventBus);
  const inventory = new MockInventoryRepository(store, eventBus);
  const product = await products.create({
    tenantId: "tenant-demo",
    sku: "DEMO-NEW",
    name: "Producto demo",
    productType: ProductType.physical,
    categoryId: "cat-tools",
    baseUnitId: "unit-unit",
    salePrice: 10,
    status: ProductStatus.published,
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    channels: { ecommerce: true, pos: true, mobileApp: false },
  });
  const foundProduct = await products.getById(product.id);
  const pendingOrders = await orders.getPendingForLogistics();
  const updatedOrder = await orders.getById("order-002");
  if (!updatedOrder) throw new Error("Demo order not found");
  const trackedOrder = await orders.getByTrackingToken(
    updatedOrder.tenantId,
    updatedOrder.trackingToken,
  );
  await inventory.registerMovement({
    tenantId: "tenant-demo",
    branchId: "branch-centro",
    productId: product.id,
    type: InventoryMovementType.in,
    reason: "Demo scenario",
    quantity: 5,
    toLocationId: "loc-centro-a",
  });
  const balances = await inventory.getBalanceByProduct(product.id, "branch-centro");
  return { foundProduct, pendingOrders, trackedOrder, balances };
}
