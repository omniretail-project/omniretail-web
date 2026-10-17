import assert from "node:assert/strict";
import type { CreateOrderInput } from "@/core/repositories";
import { DeliveryMethod, OrderSource, OrderStatus, TransportMode } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";

class MemoryStorageAdapter extends LocalStorageAdapter {
  readonly values = new Map<string, string>();
  removeCalls = 0;

  override get<T>(key: string): T | null {
    const rawValue = this.values.get(key);
    return rawValue === undefined ? null : (JSON.parse(rawValue) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.removeCalls += 1;
    this.values.delete(key);
  }
}

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const productId = "prod-screws";

function createOrderInput(
  suffix: string,
  options: {
    deliveryMethod?: DeliveryMethod;
    source?: OrderSource;
    recipientPhone?: string;
    includeDeliveryAddress?: boolean;
    idempotencyKey?: string;
    storePickupContact?: { recipientName: string; recipientPhone: string };
  } = {},
): CreateOrderInput {
  const deliveryMethod = options.deliveryMethod ?? DeliveryMethod.home_delivery;
  const includeDeliveryAddress = options.includeDeliveryAddress ?? true;
  return {
    tenantId,
    branchId,
    orderNumber: `ORDER-PHONE-${suffix}`,
    source: options.source ?? OrderSource.ecommerce,
    items: [
      {
        id: `item-phone-${suffix}`,
        productId,
        skuSnapshot: "TOR-001",
        nameSnapshot: "Tornillos",
        quantity: 1,
        unitPrice: 24.99,
        discount: 0,
        subtotal: 24.99,
      },
    ],
    status: OrderStatus.pending,
    deliveryMethod,
    transportMode:
      deliveryMethod === DeliveryMethod.home_delivery
        ? TransportMode.own_fleet
        : TransportMode.customer,
    deliveryAddress: includeDeliveryAddress
      ? {
          recipientName: "Persona Receptora",
          recipientPhone: options.recipientPhone,
          line1: "Zona 1",
          city: "Guatemala",
          country: "Guatemala",
        }
      : undefined,
    storePickupContact: options.storePickupContact,
    subtotal: 24.99,
    discountTotal: 0,
    shippingTotal: 0,
    total: 24.99,
    trackingToken: `tracking-phone-${suffix}`,
    idempotencyKey: options.idempotencyKey,
  };
}

async function verifyRecipientPhoneContract() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  store.transact((db) => {
    db.orders = [];
    db.inventoryReservations = [];
  });
  const orders = new MockOrderRepository(store, new DataEventBus());

  const validInput = createOrderInput("valid", {
    recipientPhone: "55550000",
    idempotencyKey: "recipient-phone-idempotency",
  });
  const created = await orders.create(validInput);
  assert.equal(created.deliveryAddress?.recipientPhone, "55550000");
  assert.equal(store.getSnapshot().orders[0]?.deliveryAddress?.recipientPhone, "55550000");

  await assert.rejects(orders.create(createOrderInput("missing")), /recipientPhone is required/);
  await assert.rejects(
    orders.create(createOrderInput("empty", { recipientPhone: "" })),
    /recipientPhone is required/,
  );
  await assert.rejects(
    orders.create(createOrderInput("invalid", { recipientPhone: "1234abcd" })),
    /solo puede contener números/,
  );

  const pickup = await orders.create(
    createOrderInput("pickup", {
      deliveryMethod: DeliveryMethod.store_pickup,
      source: OrderSource.pos,
      includeDeliveryAddress: false,
      storePickupContact: {
        recipientName: "  Persona que retira  ",
        recipientPhone: " 55550003 ",
      },
    }),
  );
  assert.equal(pickup.deliveryAddress, undefined);
  assert.deepEqual(pickup.storePickupContact, {
    recipientName: "Persona que retira",
    recipientPhone: "55550003",
  });
  await assert.rejects(
    orders.create(
      createOrderInput("pickup-missing-contact", {
        deliveryMethod: DeliveryMethod.store_pickup,
        source: OrderSource.pos,
        includeDeliveryAddress: false,
      }),
    ),
    /recipientName is required/,
  );
  await assert.rejects(
    orders.create(
      createOrderInput("pickup-missing-phone", {
        deliveryMethod: DeliveryMethod.store_pickup,
        source: OrderSource.pos,
        includeDeliveryAddress: false,
        storePickupContact: { recipientName: "Persona que retira", recipientPhone: "" },
      }),
    ),
    /recipientPhone is required/,
  );
  await assert.rejects(
    orders.create(
      createOrderInput("pickup-invalid-phone", {
        deliveryMethod: DeliveryMethod.store_pickup,
        source: OrderSource.pos,
        includeDeliveryAddress: false,
        storePickupContact: { recipientName: "Persona que retira", recipientPhone: "1234" },
      }),
    ),
    /exactamente 8 dígitos/,
  );
  await assert.rejects(
    orders.create({
      ...validInput,
      orderNumber: "ORDER-PHONE-HOME-CONTACT",
      trackingToken: "tracking-phone-home-contact",
      idempotencyKey: undefined,
      storePickupContact: { recipientName: "No permitido", recipientPhone: "55550004" },
    }),
    /Only store pickup/,
  );

  const posOrder = await orders.create(
    createOrderInput("pos", { recipientPhone: "55550002", source: OrderSource.pos }),
  );
  assert.equal(posOrder.deliveryAddress?.recipientPhone, "55550002");

  const repeated = await orders.create(validInput);
  assert.equal(repeated.id, created.id);
  await assert.rejects(
    orders.create({
      ...validInput,
      deliveryAddress: { ...validInput.deliveryAddress!, recipientPhone: "55550001" },
    }),
    /idempotency conflict/,
  );

  store.transact((db) => {
    db.orders.push({
      ...created,
      id: "legacy-order-without-recipient-phone",
      orderNumber: "LEGACY-001",
      trackingToken: "legacy-tracking-token",
      idempotencyKey: undefined,
      idempotencyFingerprint: undefined,
      deliveryAddress: {
        recipientName: "Receptor Legacy",
        line1: "Zona 2",
        city: "Guatemala",
        country: "Guatemala",
      },
    });
  });

  const persistedOrderCount = store.getSnapshot().orders.length;
  const reloadedStore = new MockDatabaseStore(storage);
  const reloadedOrders = new MockOrderRepository(reloadedStore, new DataEventBus());
  const reloaded = await reloadedOrders.getById(created.id);
  const legacy = await reloadedOrders.getById("legacy-order-without-recipient-phone");
  assert.equal(reloaded?.deliveryAddress?.recipientPhone, "55550000");
  assert.equal(legacy?.deliveryAddress?.recipientPhone, undefined);
  assert.equal(reloadedStore.getSnapshot().orders.length, persistedOrderCount);
  assert.equal(storage.removeCalls, 0);

  assert.equal(
    await reloadedOrders.getByTrackingToken("tenant-foreign", created.trackingToken),
    null,
  );
  assert.equal(
    (await reloadedOrders.getByTrackingToken(tenantId, created.trackingToken))?.id,
    created.id,
  );

  console.log("Order recipient phone shared contract harness: PASS");
}

void verifyRecipientPhoneContract();
