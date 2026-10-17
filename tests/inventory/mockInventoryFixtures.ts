import { LocationStatus } from "@/core/enums";
import type { InventoryBalance } from "@/core/entities";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";

/** Almacenamiento en memoria: las pruebas nunca tocan localStorage ni comparten estado. */
export class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

export const PLAIN_PRODUCT_ID = "product-plain-test";
export const LOT_PRODUCT_ID = "product-lot-test";
export const SERIAL_PRODUCT_ID = "product-serial-test";
export const LOCATION_A_ID = "location-a-test";
export const LOCATION_B_ID = "location-b-test";
export const ORDER_ID = "order-test";
export const ORDER_ITEM_ID = "order-item-test";
export const OTHER_TENANT_ID = "tenant-other-test";
export const OTHER_BRANCH_ID = "branch-other-test";

/**
 * Escenario aislado sobre la semilla demo: clona un producto, una ubicacion y una orden existentes
 * para crear tres productos de prueba (simple, con lote y con serie), dos ubicaciones activas y
 * una orden de 3 unidades del producto simple. No hay saldos hasta que cada prueba los agrega.
 */
export function createInventoryScenario() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const eventBus = new DataEventBus();
  const repository = new MockInventoryRepository(store, eventBus);
  const snapshot = store.getSnapshot();
  const settings = snapshot.productInventorySettings.find((item) => item.defaultLocationId);
  const baseProduct = snapshot.products.find((item) => item.id === settings?.productId);
  const baseLocation = snapshot.storageLocations.find(
    (item) => item.id === settings?.defaultLocationId,
  );
  const baseOrder = snapshot.orders.find((item) => item.items.length > 0);
  if (!settings || !baseProduct || !baseLocation || !baseOrder) {
    throw new Error("Fixture sin datos base de inventario.");
  }
  const { tenantId, branchId } = settings;
  const tracking = { stock: true, lot: false, expiration: false, serial: false };

  store.mutate((database) => {
    database.products.push(
      { ...baseProduct, id: PLAIN_PRODUCT_ID, tenantId, sku: "PLAIN-TEST", tracking },
      {
        ...baseProduct,
        id: LOT_PRODUCT_ID,
        tenantId,
        sku: "LOT-TEST",
        tracking: { ...tracking, lot: true },
      },
      {
        ...baseProduct,
        id: SERIAL_PRODUCT_ID,
        tenantId,
        sku: "SERIAL-TEST",
        tracking: { ...tracking, serial: true },
      },
    );
    database.storageLocations.push(
      {
        ...baseLocation,
        id: LOCATION_A_ID,
        tenantId,
        branchId,
        code: "A-TEST",
        status: LocationStatus.active,
      },
      {
        ...baseLocation,
        id: LOCATION_B_ID,
        tenantId,
        branchId,
        code: "B-TEST",
        status: LocationStatus.active,
      },
    );
    database.orders.push({
      ...baseOrder,
      id: ORDER_ID,
      tenantId,
      branchId,
      items: [
        {
          ...baseOrder.items[0],
          id: ORDER_ITEM_ID,
          orderId: ORDER_ID,
          productId: PLAIN_PRODUCT_ID,
          quantity: 3,
          inventoryQuantity: 3,
          fulfillmentComponents: undefined,
        },
      ],
    });
  });

  return {
    store,
    eventBus,
    repository,
    tenantId,
    branchId,
    /** Ubicacion que la semilla ya asigna a algun producto (no se puede inactivar). */
    assignedLocationId: baseLocation.id,
  };
}

export function addBalance(
  store: MockDatabaseStore,
  balance: Partial<InventoryBalance> & Pick<InventoryBalance, "id" | "tenantId" | "branchId" | "productId">,
) {
  store.mutate((database) => {
    database.inventoryBalances.push({
      quantity: 0,
      reservedQuantity: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...balance,
    });
  });
}

export interface RecordedEvent {
  name: DataEventName;
  payload: DataEventPayload;
}

/** Registra en orden los eventos de inventario y stock que emite el repositorio. */
export function recordInventoryEvents(eventBus: DataEventBus): RecordedEvent[] {
  const events: RecordedEvent[] = [];
  eventBus.subscribe("inventory.changed", (payload) =>
    events.push({ name: "inventory.changed", payload }),
  );
  eventBus.subscribe("stock.changed", (payload) =>
    events.push({ name: "stock.changed", payload }),
  );
  return events;
}
