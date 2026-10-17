import assert from "node:assert/strict";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import {
  DeliveryMethod,
  InventoryReservationStatus,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductType,
  TransportMode,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";
import { MockOrderPaymentConfirmationRepository } from "@/infrastructure/mock/repositories/MockOrderPaymentConfirmationRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPlanRepository } from "@/infrastructure/mock/repositories/MockPlanRepository";
import { MockPromotionRepository } from "@/infrastructure/mock/repositories/MockPromotionRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockProductSalesPriceTierRepository } from "@/infrastructure/mock/repositories/MockProductSalesPriceTierRepository";
import { MockSaleConfirmationRepository } from "@/infrastructure/mock/repositories/MockSaleConfirmationRepository";
import { MockTenantRepository } from "@/infrastructure/mock/repositories/MockTenantRepository";
import { MockTenantSubscriptionRepository } from "@/infrastructure/mock/repositories/MockTenantSubscriptionRepository";
import { MockUnitRepository } from "@/infrastructure/mock/repositories/MockUnitRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import {
  getInventoryAvailabilityAlertMessage,
  getInventoryMinimumDeficit,
  getSuggestedReorderQuantity,
} from "@/modules/inventory/application/services/GetInventoryAlertsService";
import type { StorefrontCheckoutFormDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import { CreateStorefrontCheckoutService } from "@/modules/storefront/application/services/CreateStorefrontCheckoutService";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const physicalProductId = "prod-screws";

function createHarness(physicalQuantity: number, reservedQuantity = 0) {
  const store = new MockDatabaseStore(new LocalStorageAdapter());
  store.transact((db) => {
    db.orders = [];
    db.payments = [];
    db.inventoryReservations = [];
    db.inventoryReservationConsumeOperations = [];
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
    });
    const balance = db.inventoryBalances.find((item) => item.id === "bal-screws");
    assert.ok(balance);
    balance.quantity = physicalQuantity;
    balance.reservedQuantity = reservedQuantity;
    const template = db.products.find((item) => item.id === physicalProductId);
    assert.ok(template);
    const now = "2026-01-01T12:00:00.000Z";
    db.products.push(
      {
        ...template,
        id: "prod-install",
        sku: "HARNESS-SERVICE",
        barcode: undefined,
        name: "Servicio fixture",
        productType: ProductType.service,
        salePrice: 250,
        tracking: { stock: false, lot: false, expiration: false, serial: false },
      },
      {
        ...template,
        id: "prod-analgesic",
        sku: "HARNESS-COMPONENT",
        barcode: undefined,
        name: "Componente físico fixture",
        tracking: { stock: true, lot: true, expiration: false, serial: false },
      },
      {
        ...template,
        id: "prod-kit",
        sku: "HARNESS-KIT",
        barcode: undefined,
        name: "Kit fixture",
        productType: ProductType.kit,
        tracking: { stock: false, lot: false, expiration: false, serial: false },
      },
    );
    db.productKitComponents.push(
      {
        id: "harness-kit-component-a",
        tenantId,
        kitProductId: "prod-kit",
        componentProductId: "prod-analgesic",
        quantityPerKit: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "harness-kit-component-b",
        tenantId,
        kitProductId: "prod-kit",
        componentProductId: physicalProductId,
        quantityPerKit: 1,
        createdAt: now,
        updatedAt: now,
      },
    );
    db.inventoryBalances.push({
      id: "bal-analgesic",
      tenantId,
      branchId,
      productId: "prod-analgesic",
      locationId: "loc-centro-a",
      quantity: physicalQuantity,
      reservedQuantity: 0,
      minStock: 1,
      updatedAt: now,
    });
    db.stockLots.push({
      id: "lot-harness-component",
      tenantId,
      branchId,
      productId: "prod-analgesic",
      locationId: "loc-centro-a",
      lotNumber: "HARNESS-LOT",
      quantity: physicalQuantity,
      createdAt: now,
    });
  });
  const eventBus = new DataEventBus();
  const orders = new MockOrderRepository(store, eventBus);
  const confirmations = new MockOrderPaymentConfirmationRepository(store, eventBus);
  const repositories = {
    auth: {
      getCurrentSessionId: async () => null,
    },
    branches: new MockBranchRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    customers: {},
    orderPaymentConfirmations: confirmations,
    orders,
    plans: new MockPlanRepository(store, eventBus),
    promotions: new MockPromotionRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    productSalesPriceTiers: new MockProductSalesPriceTierRepository(store, eventBus),
    roles: {},
    tenants: new MockTenantRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    users: {},
    units: new MockUnitRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
  return {
    store,
    orders,
    confirmations,
    checkout: new CreateStorefrontCheckoutService(repositories),
  };
}

const checkoutForm: StorefrontCheckoutFormDto = {
  fullName: "Cliente QA",
  email: "qa@example.com",
  phone: "55550000",
  addressLine1: "Zona 1",
  city: "Guatemala",
  cardholderName: "Cliente QA",
  cardLastFour: "4242",
};

function storefrontCart(quantity: number, productId = physicalProductId) {
  return [
    {
      productId,
      tenantId,
      sku: productId,
      name: productId,
      unitPrice: 1,
      quantity,
    },
  ];
}

async function createPendingCheckout(
  orders: MockOrderRepository,
  suffix: string,
  options: {
    method?: PaymentMethod;
    productId?: string;
    quantity?: number;
  } = {},
) {
  const method = options.method ?? PaymentMethod.card;
  const productId = options.productId ?? physicalProductId;
  const quantity = options.quantity ?? 1;
  const unitPrice = productId === "prod-install" ? 250 : 24.99;
  const total = unitPrice * quantity;

  return orders.createWithPayment({
    order: {
      tenantId,
      branchId,
      orderNumber: `WEB-${suffix}`,
      source: OrderSource.ecommerce,
      items: [
        {
          id: `item-${suffix}`,
          productId,
          skuSnapshot: suffix,
          nameSnapshot: suffix,
          quantity,
          unitPrice,
          discount: 0,
          subtotal: total,
        },
      ],
      status: OrderStatus.pending,
      deliveryMethod: DeliveryMethod.home_delivery,
      transportMode: TransportMode.third_party,
      deliveryAddress: {
        recipientName: "Cliente QA",
        recipientPhone: "55550000",
        line1: "Zona 1",
        city: "Guatemala",
        country: "Guatemala",
      },
      subtotal: total,
      discountTotal: 0,
      shippingTotal: 0,
      total,
      trackingToken: `tracking-${suffix}`,
      idempotencyKey: `checkout-${suffix}`,
    },
    payment: {
      tenantId,
      method,
      status: PaymentStatus.pending,
      amount: total,
      currency: "GTQ",
    },
  });
}

async function verifyConsecutiveStorefrontOrders() {
  const { store, checkout } = createHarness(20);
  await checkout.execute({
    tenantSlug: publicStorefrontSlug,
    items: storefrontCart(1),
    form: checkoutForm,
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
  });
  await checkout.execute({
    tenantSlug: publicStorefrontSlug,
    items: storefrontCart(1),
    form: checkoutForm,
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
  });

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.orders.length, 2);
  assert.equal(snapshot.inventoryReservations.length, 2);
  assert.equal(snapshot.orders[0].deliveryAddress?.recipientPhone, checkoutForm.phone);
  assert.deepEqual(snapshot.orders[0].notificationContact, {
    emailMode: "send",
    email: checkoutForm.email,
  });
  assert.equal(snapshot.orders[0].deliveryAddress?.references, undefined);
  assert.notEqual(snapshot.orders[0].items[0].id, snapshot.orders[1].items[0].id);
  assert.equal(
    snapshot.inventoryBalances.find((item) => item.id === "bal-screws")?.reservedQuantity,
    2,
  );
  assert.equal(
    snapshot.inventoryReservations.every(
      (reservation) => reservation.status === InventoryReservationStatus.active,
    ),
    true,
  );
}

async function verifyStorefrontSaleUnitConversion() {
  const { store, checkout } = createHarness(250);
  store.mutate((db) => {
    const product = db.products.find((item) => item.id === physicalProductId);
    assert.ok(product);
    product.baseUnitId = "unit-unit";
    product.saleUnitId = "unit-box";
    product.inventoryUnitId = "unit-box";
    db.unitConversions = db.unitConversions.filter(
      (item) => !(item.productId === physicalProductId && item.fromUnitId === "unit-box"),
    );
    db.unitConversions.push({
      id: "conversion-storefront-box-base",
      tenantId,
      productId: physicalProductId,
      fromUnitId: "unit-box",
      toUnitId: "unit-unit",
      factor: 100,
      createdAt: new Date().toISOString(),
    });
  });
  await checkout.execute({
    tenantSlug: publicStorefrontSlug,
    items: storefrontCart(2),
    form: checkoutForm,
    idempotencyKey: "00000000-0000-4000-8000-000000000099",
  });
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.orders[0].items[0].quantity, 2);
  assert.equal(snapshot.orders[0].items[0].inventoryQuantity, 200);
  assert.equal(
    snapshot.inventoryReservations[0].allocations.reduce(
      (sum, allocation) => sum + allocation.reservedQuantity,
      0,
    ),
    200,
  );
}

async function verifyStorefrontMissingConversionFailsClosed() {
  const { store, checkout } = createHarness(250);
  store.mutate((db) => {
    const product = db.products.find((item) => item.id === physicalProductId);
    assert.ok(product);
    product.baseUnitId = "unit-unit";
    product.saleUnitId = "unit-pack";
    db.unitConversions = db.unitConversions.filter((item) => item.productId !== physicalProductId);
  });
  await assert.rejects(
    () => checkout.execute({
      tenantSlug: publicStorefrontSlug,
      items: storefrontCart(1),
      form: checkoutForm,
      idempotencyKey: "00000000-0000-4000-8000-000000000098",
    }),
    /No existe conversion/,
  );
  assert.equal(store.getSnapshot().orders.length, 0);
}

async function verifyAccumulatedReservationQaCase() {
  const { store, checkout } = createHarness(15, 6);
  const successfulKey = "00000000-0000-4000-8000-000000000007";
  const successful = await checkout.execute({
    tenantSlug: publicStorefrontSlug,
    items: storefrontCart(7),
    form: checkoutForm,
    idempotencyKey: successfulKey,
  });
  assert.equal(successful.orderStatus, OrderStatus.confirmed);
  assert.equal(successful.paymentStatus, PaymentStatus.approved);

  let snapshot = store.getSnapshot();
  let balance = snapshot.inventoryBalances.find((item) => item.id === "bal-screws");
  assert.equal(balance?.quantity, 15);
  assert.equal(balance?.reservedQuantity, 13);
  assert.equal((balance?.quantity ?? 0) - (balance?.reservedQuantity ?? 0), 2);
  assert.equal(snapshot.inventoryReservations.length, 1);
  const persistedOrderItemId = snapshot.orders[0].items[0].id;

  await checkout.execute({
    tenantSlug: publicStorefrontSlug,
    items: storefrontCart(7),
    form: checkoutForm,
    idempotencyKey: successfulKey,
  });
  snapshot = store.getSnapshot();
  balance = snapshot.inventoryBalances.find((item) => item.id === "bal-screws");
  assert.equal(balance?.reservedQuantity, 13);
  assert.equal(snapshot.inventoryReservations.length, 1);
  assert.equal(snapshot.orders[0].items[0].id, persistedOrderItemId);

  await assert.rejects(
    checkout.execute({
      tenantSlug: publicStorefrontSlug,
      items: storefrontCart(3),
      form: checkoutForm,
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
    }),
    /No hay suficiente disponibilidad/,
  );
  snapshot = store.getSnapshot();
  balance = snapshot.inventoryBalances.find((item) => item.id === "bal-screws");
  assert.equal(balance?.quantity, 15);
  assert.equal(balance?.reservedQuantity, 13);
  assert.equal(snapshot.inventoryReservations.length, 1);
  assert.equal(snapshot.orders.length, 1);
  assert.equal(snapshot.payments.length, 1);
  assert.equal(
    snapshot.orders.some((order) => order.status === OrderStatus.pending),
    false,
  );
  assert.equal(
    snapshot.payments.some((payment) => payment.status === PaymentStatus.pending),
    false,
  );
}

async function verifyImmediateCardAndLifecycle() {
  const { store, orders, confirmations } = createHarness(10);
  const created = await createPendingCheckout(orders, "card", { quantity: 3 });
  const confirmed = await confirmations.confirm({
    tenantId,
    branchId,
    orderId: created.order.id,
    paymentId: created.payment.id,
  });
  let snapshot = store.getSnapshot();
  let balance = snapshot.inventoryBalances.find((item) => item.id === "bal-screws");
  assert.ok(balance);
  assert.equal(confirmed.order.status, OrderStatus.confirmed);
  assert.equal(confirmed.payment.status, PaymentStatus.approved);
  assert.equal(balance.quantity, 10);
  assert.equal(balance.reservedQuantity, 3);
  assert.equal(snapshot.inventoryReservations.length, 1);
  assert.equal(snapshot.inventoryReservations[0].status, InventoryReservationStatus.active);

  const retry = await confirmations.confirm({
    tenantId,
    branchId,
    orderId: created.order.id,
    paymentId: created.payment.id,
  });
  snapshot = store.getSnapshot();
  balance = snapshot.inventoryBalances.find((item) => item.id === "bal-screws");
  assert.equal(retry.idempotent, true);
  assert.equal(snapshot.inventoryReservations.length, 1);
  assert.equal(balance?.reservedQuantity, 3);

  await orders.updateStatus(created.order.id, OrderStatus.cancelled);
  snapshot = store.getSnapshot();
  balance = snapshot.inventoryBalances.find((item) => item.id === "bal-screws");
  assert.equal(balance?.quantity, 10);
  assert.equal(balance?.reservedQuantity, 0);
  assert.equal(snapshot.inventoryReservations[0].status, InventoryReservationStatus.released);
}

async function verifyDeferredMethodsStayPending() {
  for (const method of [PaymentMethod.cash, PaymentMethod.transfer]) {
    const { store, orders, confirmations } = createHarness(10);
    const created = await createPendingCheckout(orders, `deferred-${method}`, { method });
    await assert.rejects(
      confirmations.confirm({
        tenantId,
        branchId,
        orderId: created.order.id,
        paymentId: created.payment.id,
      }),
      /does not allow immediate mock approval/,
    );
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.orders[0].status, OrderStatus.pending);
    assert.equal(snapshot.payments[0].status, PaymentStatus.pending);
    assert.equal(snapshot.inventoryReservations.length, 0);
    assert.equal(
      snapshot.inventoryBalances.find((item) => item.id === "bal-screws")?.reservedQuantity,
      0,
    );
  }
}

async function verifyRollbackAndIsolation() {
  const insufficient = createHarness(2);
  const created = await createPendingCheckout(insufficient.orders, "insufficient", {
    quantity: 3,
  });
  await assert.rejects(
    insufficient.confirmations.confirm({
      tenantId,
      branchId,
      orderId: created.order.id,
      paymentId: created.payment.id,
    }),
  );
  let snapshot = insufficient.store.getSnapshot();
  assert.equal(snapshot.orders.length, 0);
  assert.equal(snapshot.payments.length, 0);
  assert.equal(snapshot.inventoryReservations.length, 0);
  assert.equal(
    snapshot.inventoryBalances.find((item) => item.id === "bal-screws")?.reservedQuantity,
    0,
  );

  const isolated = createHarness(10);
  const first = await createPendingCheckout(isolated.orders, "first");
  const second = await createPendingCheckout(isolated.orders, "second");
  await assert.rejects(
    isolated.confirmations.confirm({
      tenantId,
      branchId,
      orderId: first.order.id,
      paymentId: second.payment.id,
    }),
    /does not belong to Order/,
  );
  await assert.rejects(
    isolated.confirmations.confirm({
      tenantId: "tenant-other",
      branchId,
      orderId: first.order.id,
      paymentId: first.payment.id,
    }),
    /Order not found for tenant/,
  );
  snapshot = isolated.store.getSnapshot();
  assert.equal(
    snapshot.orders.every((order) => order.status === OrderStatus.pending),
    true,
  );
  assert.equal(
    snapshot.payments.every((payment) => payment.status === PaymentStatus.pending),
    true,
  );
  assert.equal(snapshot.inventoryReservations.length, 0);
}

async function verifyServiceOrder() {
  const { store, orders, confirmations } = createHarness(10);
  const created = await createPendingCheckout(orders, "service", {
    productId: "prod-install",
  });
  const result = await confirmations.confirm({
    tenantId,
    branchId,
    orderId: created.order.id,
    paymentId: created.payment.id,
  });
  assert.equal(result.order.status, OrderStatus.confirmed);
  assert.equal(result.payment.status, PaymentStatus.approved);
  assert.equal(result.inventoryReservations.length, 0);
  assert.equal(store.getSnapshot().inventoryReservations.length, 0);
}

async function verifyKitAndTrackedProducts() {
  const kit = createHarness(10);
  const kitCheckout = await createPendingCheckout(kit.orders, "kit", {
    productId: "prod-kit",
  });
  const kitResult = await kit.confirmations.confirm({
    tenantId,
    branchId,
    orderId: kitCheckout.order.id,
    paymentId: kitCheckout.payment.id,
  });
  assert.deepEqual(
    new Set(kitResult.inventoryReservations.map((reservation) => reservation.productId)),
    new Set(["prod-analgesic", "prod-screws"]),
  );

  for (const productId of ["prod-drill", "prod-analgesic"]) {
    const tracked = createHarness(10);
    const checkout = await createPendingCheckout(tracked.orders, `tracked-${productId}`, {
      productId,
    });
    const result = await tracked.confirmations.confirm({
      tenantId,
      branchId,
      orderId: checkout.order.id,
      paymentId: checkout.payment.id,
    });
    assert.equal(result.inventoryReservations.length, 1);
    assert.equal(result.inventoryReservations[0].allocations.length > 0, true);
  }
}

async function verifyPosRegression() {
  const store = new MockDatabaseStore(new LocalStorageAdapter());
  const repository = new MockSaleConfirmationRepository(store, new DataEventBus());
  const before = store
    .getSnapshot()
    .inventoryBalances.find((balance) => balance.id === "bal-screws");
  assert.ok(before);
  const result = await repository.confirm({
    confirmationId: "pos-regression-ecommerce-payment-policy",
    tenantId,
    branchId,
    cashierUserId: "user-cashier",
    cashShiftId: "cash-shift-001",
    items: [
      {
        productId: physicalProductId,
        skuSnapshot: "TOR-001",
        nameSnapshot: "Tornillos",
        quantity: 1,
        unitPrice: 24.99,
        discount: 0,
        subtotal: 24.99,
      },
    ],
    subtotal: 24.99,
    discountTotal: 0,
    taxTotal: 0,
    total: 24.99,
    payments: [{ method: PaymentMethod.card, amount: 24.99, currency: "GTQ" }],
  });
  const after = store
    .getSnapshot()
    .inventoryBalances.find((balance) => balance.id === "bal-screws");
  assert.equal(after?.quantity, before.quantity - 1);
  assert.equal(result.inventoryMovements.length, 1);
}

async function verifyPosCanonicalDecrement() {
  const store = new MockDatabaseStore(new LocalStorageAdapter());
  const repository = new MockSaleConfirmationRepository(store, new DataEventBus());
  store.mutate((db) => {
    const balance = db.inventoryBalances.find((item) => item.id === "bal-screws");
    assert.ok(balance);
    balance.quantity = 250;
  });
  const before = store.getSnapshot().inventoryBalances.find((item) => item.id === "bal-screws");
  assert.ok(before);
  await repository.confirm({
    confirmationId: "pos-canonical-box-sale",
    tenantId,
    branchId,
    cashierUserId: "user-cashier",
    cashShiftId: "cash-shift-001",
    items: [{
      productId: physicalProductId,
      skuSnapshot: "TOR-001",
      nameSnapshot: "Tornillos",
      quantity: 1,
      inventoryQuantity: 100,
      unitPrice: 24.99,
      discount: 0,
      subtotal: 24.99,
    }],
    subtotal: 24.99,
    discountTotal: 0,
    taxTotal: 0,
    total: 24.99,
    payments: [{ method: PaymentMethod.card, amount: 24.99, currency: "GTQ" }],
  });
  const after = store.getSnapshot().inventoryBalances.find((item) => item.id === "bal-screws");
  assert.equal(after?.quantity, before.quantity - 100);
}

function verifyInventoryAlertCalculations() {
  const availability = {
    quantity: 10,
    reservedQuantity: 8,
    availableQuantity: 2,
    minStock: 5,
    status: "critical" as const,
  };
  assert.equal(getInventoryMinimumDeficit(availability), 3);
  assert.equal(getSuggestedReorderQuantity(availability), 3);
  assert.match(getInventoryAvailabilityAlertMessage(availability), /deficit 3/);
}

async function main() {
  await verifyConsecutiveStorefrontOrders();
  await verifyStorefrontSaleUnitConversion();
  await verifyStorefrontMissingConversionFailsClosed();
  await verifyAccumulatedReservationQaCase();
  await verifyImmediateCardAndLifecycle();
  await verifyDeferredMethodsStayPending();
  await verifyRollbackAndIsolation();
  await verifyServiceOrder();
  await verifyKitAndTrackedProducts();
  await verifyPosRegression();
  await verifyPosCanonicalDecrement();
  verifyInventoryAlertCalculations();
  console.log("ecommerce payment/reservation findings verification: PASS");
}

void main();
