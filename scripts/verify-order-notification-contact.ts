import assert from "node:assert/strict";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import type { CreateOrderInput } from "@/core/repositories";
import { DeliveryMethod, OrderSource, OrderStatus, TransportMode } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockCustomerRepository,
  MockOrderPaymentConfirmationRepository,
  MockOrderRepository,
  MockPlanRepository,
  MockProductRepository,
  MockRoleRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { CreateStorefrontCheckoutService } from "@/modules/storefront/application/services/CreateStorefrontCheckoutService";
import type { ConfirmPosSaleInput } from "@/modules/pos/application/services/ConfirmSaleService";

const tenantId = "tenant-demo";
const branchId = "branch-centro";

async function main() {
  const store = new MockDatabaseStore(new LocalStorageAdapter());
  store.transact((db) => {
    db.orders = [];
    db.payments = [];
    db.inventoryReservations = [];
    db.inventoryReservationConsumeOperations = [];
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
      if (balance.id === "bal-screws") balance.quantity = 50;
    });
  });
  const eventBus = new DataEventBus();
  const orders = new MockOrderRepository(store, eventBus);

  const send = await orders.create(
    createOrderInput("send", {
      notificationContact: { emailMode: "send", email: "  Buyer@Example.COM " },
      idempotencyKey: "notification-send",
    }),
  );
  assert.deepEqual(send.notificationContact, { emailMode: "send", email: "buyer@example.com" });
  const retry = await orders.create(
    createOrderInput("send", {
      notificationContact: { emailMode: "send", email: "buyer@example.com" },
      idempotencyKey: "notification-send",
    }),
  );
  assert.equal(retry.id, send.id);
  await assert.rejects(
    orders.create(
      createOrderInput("send", {
        notificationContact: { emailMode: "send", email: "other@example.com" },
        idempotencyKey: "notification-send",
      }),
    ),
    /idempotency conflict/,
  );

  const notApplicable = await orders.create(
    createOrderInput("na", { notificationContact: { emailMode: "not_applicable" } }),
  );
  assert.deepEqual(notApplicable.notificationContact, { emailMode: "not_applicable" });
  const legacy = await orders.create(createOrderInput("legacy"));
  assert.equal(legacy.notificationContact, undefined);
  const posSendContact = {
    emailMode: "send",
    email: "pos@example.com",
  } satisfies NonNullable<ConfirmPosSaleInput["notificationContact"]>;
  const posOrder = await orders.create(
    createOrderInput("pos", {
      source: OrderSource.pos,
      notificationContact: posSendContact,
    }),
  );
  assert.deepEqual(posOrder.notificationContact, posSendContact);
  await assert.rejects(
    orders.create(
      createOrderInput("invalid-email", {
        notificationContact: { emailMode: "send", email: "not-an-email" },
      }),
    ),
    /correo electrónico no es válido/i,
  );
  await assert.rejects(
    orders.create(
      createOrderInput("invalid-na", {
        notificationContact: {
          emailMode: "not_applicable",
          email: "invented@example.com",
        } as CreateOrderInput["notificationContact"],
      }),
    ),
    /cannot include email/,
  );

  let currentUserId: string | null = null;
  const repositories = {
    auth: {
      getCurrentSessionId: async () => (currentUserId ? "notification-session" : null),
      getSession: async () =>
        currentUserId
          ? {
              id: "notification-session",
              userId: currentUserId,
              createdAt: "2026-01-01T00:00:00.000Z",
              expiresAt: "2099-01-01T00:00:00.000Z",
              rememberMe: false,
            }
          : null,
    },
    branches: new MockBranchRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    orderPaymentConfirmations: new MockOrderPaymentConfirmationRepository(store, eventBus),
    orders,
    plans: new MockPlanRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
  const checkout = new CreateStorefrontCheckoutService(repositories);

  await checkout.execute({
    tenantSlug: publicStorefrontSlug,
    items: storefrontCart(),
    form: checkoutForm(" Guest@Example.COM "),
    idempotencyKey: "00000000-0000-4000-8000-000000000101",
  });
  const guestOrder = store
    .getSnapshot()
    .orders.find((order) => order.trackingToken.endsWith("0101"));
  assert.deepEqual(guestOrder?.notificationContact, {
    emailMode: "send",
    email: "guest@example.com",
  });
  assert.equal(guestOrder?.guestCustomer?.email, "guest@example.com");

  currentUserId = "user-customer";
  await checkout.execute({
    tenantSlug: publicStorefrontSlug,
    items: storefrontCart(),
    form: checkoutForm(" Historical@Example.COM "),
    idempotencyKey: "00000000-0000-4000-8000-000000000102",
  });
  const customerOrder = store
    .getSnapshot()
    .orders.find((order) => order.trackingToken.endsWith("0102"));
  assert.equal(customerOrder?.customerId, "customer-ana");
  assert.equal(customerOrder?.guestCustomer, undefined);
  assert.deepEqual(customerOrder?.notificationContact, {
    emailMode: "send",
    email: "historical@example.com",
  });
  store.transact((db) => {
    const customer = db.customers.find((item) => item.id === "customer-ana");
    assert.ok(customer);
    customer.email = "changed@example.com";
  });
  assert.equal(
    store.getSnapshot().orders.find((order) => order.id === customerOrder?.id)?.notificationContact
      ?.emailMode === "send"
      ? (
          store.getSnapshot().orders.find((order) => order.id === customerOrder?.id)
            ?.notificationContact as { emailMode: "send"; email: string }
        ).email
      : null,
    "historical@example.com",
  );

  console.log("verify-order-notification-contact: PASS");
  console.log("A-D, ecommerce guest/auth snapshot, normalization, legacy and idempotency: PASS");
}

function createOrderInput(
  suffix: string,
  overrides: Partial<CreateOrderInput> = {},
): CreateOrderInput {
  return {
    tenantId,
    branchId,
    orderNumber: `WEB-NOTIFICATION-${suffix}`,
    source: OrderSource.ecommerce,
    items: [
      {
        id: `notification-item-${suffix}`,
        productId: "prod-screws",
        skuSnapshot: "SCREWS",
        nameSnapshot: "Screws",
        quantity: 1,
        unitPrice: 24.99,
        discount: 0,
        subtotal: 24.99,
      },
    ],
    status: OrderStatus.pending,
    deliveryMethod: DeliveryMethod.home_delivery,
    transportMode: TransportMode.third_party,
    deliveryAddress: {
      recipientName: "Notification Customer",
      recipientPhone: "55550000",
      line1: "Zona 1",
      city: "Guatemala",
      country: "Guatemala",
    },
    subtotal: 24.99,
    discountTotal: 0,
    shippingTotal: 0,
    total: 24.99,
    trackingToken: `notification-tracking-${suffix}`,
    ...overrides,
  };
}

function storefrontCart() {
  return [
    {
      productId: "prod-screws",
      tenantId,
      sku: "prod-screws",
      name: "prod-screws",
      unitPrice: 1,
      quantity: 1,
    },
  ];
}

function checkoutForm(email: string) {
  return {
    fullName: "Cliente QA",
    email,
    phone: "55550000",
    addressLine1: "Zona 1",
    city: "Guatemala",
    cardholderName: "Cliente QA",
    cardLastFour: "4242",
  };
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
