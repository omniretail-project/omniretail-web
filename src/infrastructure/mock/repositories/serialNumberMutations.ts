import { SerialStatus } from "@/core/enums";
import type { SerialNumber } from "@/core/entities";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import {
  getEligibleStockLots,
  type StockLotAllocation,
} from "@/infrastructure/mock/repositories/stockLotMutations";

export function getAvailableSerials(
  db: MockDatabase,
  scope: Pick<SerialNumber, "tenantId" | "branchId" | "productId" | "locationId"> & {
    lotId?: string;
  },
): SerialNumber[] {
  return db.serialNumbers
    .filter(
      (serial) =>
        serial.tenantId === scope.tenantId &&
        serial.branchId === scope.branchId &&
        serial.productId === scope.productId &&
        (serial.locationId ?? null) === (scope.locationId ?? null) &&
        (scope.lotId === undefined || serial.lotId === scope.lotId) &&
        serial.status === SerialStatus.available,
    )
    .sort(
      (left, right) =>
        left.serialNumber.localeCompare(right.serialNumber) || left.id.localeCompare(right.id),
    );
}

export function assertNewSerials(db: MockDatabase, tenantId: string, serials: string[]): void {
  const normalized = serials.map((serial) => serial.trim());
  if (normalized.some((serial) => !serial)) throw new Error("Serial number is required");
  if (new Set(normalized).size !== normalized.length)
    throw new Error("Duplicate serial number in receipt");
  normalized.forEach((serial) => {
    if (db.serialNumbers.some((item) => item.tenantId === tenantId && item.serialNumber === serial))
      throw new Error(`Serial number already exists: ${serial}`);
  });
}

export function getSerialAwareBalances(
  db: MockDatabase,
  scope: Pick<SerialNumber, "tenantId" | "branchId" | "productId">,
) {
  return db.inventoryBalances.map((balance) => {
    if (
      balance.tenantId !== scope.tenantId ||
      balance.branchId !== scope.branchId ||
      balance.productId !== scope.productId
    ) {
      return balance;
    }
    const serialCapacity = getAvailableSerials(db, {
      ...scope,
      locationId: balance.locationId,
    }).length;
    return { ...balance, quantity: Math.min(balance.quantity, serialCapacity) };
  });
}

export function getLotSerialAwareBalances(
  db: MockDatabase,
  scope: {
    tenantId: string;
    branchId: string;
    productId: string;
    expirationTracked: boolean;
    at: string;
  },
) {
  return db.inventoryBalances.map((balance) => {
    if (
      balance.tenantId !== scope.tenantId ||
      balance.branchId !== scope.branchId ||
      balance.productId !== scope.productId
    ) {
      return balance;
    }
    const capacity = getEligibleStockLots(db, { ...scope, locationId: balance.locationId }).reduce(
      (total, lot) =>
        total +
        Math.min(
          lot.quantity,
          getAvailableSerials(db, { ...scope, locationId: balance.locationId, lotId: lot.id })
            .length,
        ),
      0,
    );
    return { ...balance, quantity: Math.min(balance.quantity, capacity) };
  });
}

export interface LotSerialAllocation {
  lotAllocation: StockLotAllocation;
  serialNumbers: SerialNumber[];
}

export function planLotSerialConsumption(
  db: MockDatabase,
  scope: {
    tenantId: string;
    branchId: string;
    productId: string;
    locationId?: string;
    expirationTracked: boolean;
    at: string;
  },
  quantity: number,
  requestedSerialNumbers?: string[],
): LotSerialAllocation[] {
  const requested = requestedSerialNumbers?.map((serial) => serial.trim()).filter(Boolean);
  if (
    requested?.length &&
    (requested.length !== quantity || new Set(requested).size !== requested.length)
  ) {
    throw new Error("Requested serial numbers must exactly match the consumed quantity");
  }
  let remaining = quantity;
  const planned = getEligibleStockLots(db, scope).flatMap((lot) => {
    if (remaining <= 0) return [];
    const available = getAvailableSerials(db, { ...scope, lotId: lot.id });
    const consumed = Math.min(lot.quantity, available.length, remaining);
    if (consumed <= 0) return [];
    remaining -= consumed;
    const requestedForLot = requested?.filter((serial) =>
      available.some((item) => item.serialNumber === serial),
    );
    if (requested && requestedForLot?.length !== consumed) {
      throw new Error("Requested serial numbers do not match FEFO lot allocation");
    }
    return [
      {
        lotAllocation: { lot, quantity: consumed },
        serialNumbers: requestedForLot
          ? planSerialConsumption(db, { ...scope, lotId: lot.id }, consumed, requestedForLot)
          : available.slice(0, consumed),
      },
    ];
  });
  if (remaining > 0) throw new Error("Insufficient eligible lot serial stock");
  return planned;
}

export function planSerialConsumption(
  db: MockDatabase,
  scope: Pick<SerialNumber, "tenantId" | "branchId" | "productId" | "locationId"> & {
    lotId?: string;
  },
  quantity: number,
  requestedSerialNumbers?: string[],
): SerialNumber[] {
  const available = getAvailableSerials(db, scope);
  const requested = requestedSerialNumbers?.map((serial) => serial.trim()).filter(Boolean);
  if (requested?.length) {
    if (requested.length !== quantity || new Set(requested).size !== requested.length) {
      throw new Error("Requested serial numbers must exactly match the consumed quantity");
    }
    const selected = requested.map((serialNumber) => {
      const serial = available.find((item) => item.serialNumber === serialNumber);
      if (!serial)
        throw new Error(`Serial number is not available in reserved location: ${serialNumber}`);
      return serial;
    });
    return selected;
  }
  if (available.length < quantity) throw new Error("Insufficient available serial numbers");
  return available.slice(0, quantity);
}

export function consumePlannedSerials(
  serials: SerialNumber[], now: string, targetStatus: SerialStatus = SerialStatus.sold,
): void {
  serials.forEach((serial) => {
    if (serial.status !== SerialStatus.available) {
      throw new Error(`Serial number is no longer available: ${serial.serialNumber}`);
    }
  });
  serials.forEach((serial) => {
    serial.status = targetStatus;
    serial.updatedAt = now;
  });
}
