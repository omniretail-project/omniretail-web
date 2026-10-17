import type {
  InventoryBalance,
  InventoryReservation,
  Product,
  SerialNumber,
  StockLot,
  StorageLocation,
} from "@/core/entities";
import { InventoryReservationStatus, LocationStatus, SerialStatus } from "@/core/enums";
import type {
  PickingInventoryAvailability,
  PickingInventoryLocationAvailability,
} from "@/core/repositories/InventoryRepository";

export function buildPickingInventoryAvailability(input: {
  tenantId: string;
  branchId: string;
  pickingOrderId: string;
  orderId?: string;
  sourceType?: "order" | "transfer";
  sourceId?: string;
  product: Product;
  balances: InventoryBalance[];
  reservations: InventoryReservation[];
  lots: StockLot[];
  serials: SerialNumber[];
  locations: StorageLocation[];
  at: string;
}): PickingInventoryAvailability {
  const scopedLocations = input.locations.filter(
    (location) =>
      location.tenantId === input.tenantId &&
      location.branchId === input.branchId &&
      location.status === LocationStatus.active,
  );
  const activeLocationIds = new Set(scopedLocations.map((location) => location.id));
  const ownReservations = input.reservations.filter(
    (reservation) =>
      reservation.tenantId === input.tenantId &&
      reservation.branchId === input.branchId &&
      (input.sourceType === "transfer"
        ? reservation.sourceType === "transfer" && reservation.sourceId === input.sourceId
        : reservation.sourceType !== "transfer" && reservation.orderId === input.orderId) &&
      reservation.productId === input.product.id &&
      reservation.status !== InventoryReservationStatus.released,
  );

  const rows = input.balances
    .filter(
      (balance) =>
        balance.tenantId === input.tenantId &&
        balance.branchId === input.branchId &&
        balance.productId === input.product.id &&
        (!balance.locationId || activeLocationIds.has(balance.locationId)),
    )
    .map<PickingInventoryLocationAvailability>((balance) => {
      const location = scopedLocations.find((entry) => entry.id === balance.locationId);
      const lots = getEligibleLots(input, balance.locationId);
      const serials = getEligibleSerials(input, balance.locationId);
      const traceableCapacity = input.product.tracking.lot
        ? lots.reduce((total, lot) => total + lot.physicalQuantity, 0)
        : input.product.tracking.serial
          ? serials.length
          : balance.quantity;
      const physicalQuantity = Math.max(Math.min(balance.quantity, traceableCapacity), 0);
      const ownReservedQuantity = ownReservations.reduce(
        (total, reservation) =>
          total +
          reservation.allocations
            .filter((allocation) => allocation.balanceId === balance.id)
            .reduce(
              (sum, allocation) =>
                sum + Math.max(allocation.reservedQuantity - allocation.consumedQuantity, 0),
              0,
            ),
        0,
      );
      const otherReservedQuantity = Math.max(balance.reservedQuantity - ownReservedQuantity, 0);
      const freeQuantity = Math.max(physicalQuantity - balance.reservedQuantity, 0);
      const usableQuantity = Math.min(physicalQuantity, ownReservedQuantity + freeQuantity);

      return {
        balanceId: balance.id,
        locationId: balance.locationId,
        locationCode: location?.code,
        locationName: location?.name,
        physicalQuantity,
        ownReservedQuantity,
        otherReservedQuantity,
        freeQuantity,
        usableQuantity,
        lots,
        serialNumbers: serials.map((serial) => ({
          id: serial.id,
          serialNumber: serial.serialNumber,
          lotId: serial.lotId,
        })),
      };
    });

  return {
    tenantId: input.tenantId,
    branchId: input.branchId,
    pickingOrderId: input.pickingOrderId,
    orderId: input.orderId,
    productId: input.product.id,
    physicalQuantity: sum(rows, "physicalQuantity"),
    ownReservedQuantity: sum(rows, "ownReservedQuantity"),
    otherReservedQuantity: sum(rows, "otherReservedQuantity"),
    freeQuantity: sum(rows, "freeQuantity"),
    usableQuantity: sum(rows, "usableQuantity"),
    locations: rows,
  };
}

function getEligibleLots(
  input: Parameters<typeof buildPickingInventoryAvailability>[0],
  locationId?: string,
) {
  return input.lots
    .filter(
      (lot) =>
        lot.tenantId === input.tenantId &&
        lot.branchId === input.branchId &&
        lot.productId === input.product.id &&
        (lot.locationId ?? null) === (locationId ?? null) &&
        isLotEligible(lot, input.product.tracking.expiration, input.at),
    )
    .map((lot) => {
      const serialNumbers = input.product.tracking.serial
        ? getEligibleSerials(input, locationId).filter((serial) => serial.lotId === lot.id)
        : [];
      return {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        expirationDate: lot.expirationDate,
        physicalQuantity: input.product.tracking.serial
          ? Math.min(lot.quantity, serialNumbers.length)
          : lot.quantity,
        serialNumbers: serialNumbers.map((serial) => ({
          id: serial.id,
          serialNumber: serial.serialNumber,
        })),
      };
    });
}

function getEligibleSerials(
  input: Parameters<typeof buildPickingInventoryAvailability>[0],
  locationId?: string,
) {
  return input.serials.filter(
    (serial) =>
      serial.tenantId === input.tenantId &&
      serial.branchId === input.branchId &&
      serial.productId === input.product.id &&
      (serial.locationId ?? null) === (locationId ?? null) &&
      serial.status === SerialStatus.available,
  );
}

function isLotEligible(lot: StockLot, expirationTracked: boolean, at: string) {
  if (!expirationTracked || !lot.expirationDate) return true;
  const businessDate = new Date(`${at.slice(0, 10)}T00:00:00.000Z`).getTime();
  return new Date(lot.expirationDate).getTime() >= businessDate;
}

function sum(
  rows: PickingInventoryLocationAvailability[],
  key:
    | "physicalQuantity"
    | "ownReservedQuantity"
    | "otherReservedQuantity"
    | "freeQuantity"
    | "usableQuantity",
) {
  return rows.reduce((total, row) => total + row[key], 0);
}
