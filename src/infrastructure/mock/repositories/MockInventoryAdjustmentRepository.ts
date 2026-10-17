import {
  InventoryAdjustmentType,
  InventoryMovementType,
  LocationStatus,
  SerialStatus,
} from "@/core/enums";
import type {
  InventoryAdjustment,
  InventoryMovement,
  SerialNumber,
  StockLot,
} from "@/core/entities";
import type {
  CreateInventoryAdjustmentInput,
  InventoryAdjustmentRepository,
} from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockInventoryAdjustmentRepository
  extends BaseMockRepository
  implements InventoryAdjustmentRepository
{
  // El mock resuelve lotes/series desde las filas del read model; estos lookups son del modo API.
  async listAvailableLots() {
    return [];
  }

  async listAvailableSerials() {
    return [];
  }

  async validateNewSerials(
    input: Parameters<InventoryAdjustmentRepository["validateNewSerials"]>[0],
  ) {
    const seen = new Set<string>();
    const repeatedInRequest = new Set<string>();
    input.serialNumbers.forEach((serial) => {
      if (seen.has(serial)) repeatedInRequest.add(serial);
      seen.add(serial);
    });
    return { duplicates: [], repeatedInRequest: [...repeatedInRequest] };
  }

  // El conteo fisico trazable solo existe en modo API; el mock conserva el ajuste anterior.
  async getCountSnapshot(): Promise<never> {
    throw new Error("El conteo fisico trazable no esta disponible en modo mock.");
  }

  async reconcileCount(): Promise<never> {
    throw new Error("El conteo fisico trazable no esta disponible en modo mock.");
  }

  // La regularizacion de balances heredados solo existe contra el backend; sin fallback silencioso.
  async getLocationRegularizationOptions(): Promise<never> {
    throw new Error("La regularizacion de ubicaciones no esta disponible en modo mock.");
  }

  async previewLocationRegularization(): Promise<never> {
    throw new Error("La regularizacion de ubicaciones no esta disponible en modo mock.");
  }

  async regularizeLocationBalance(): Promise<never> {
    throw new Error("La regularizacion de ubicaciones no esta disponible en modo mock.");
  }

  async getById(id: string) {
    return this.read((db) => db.inventoryAdjustments.find((item) => item.id === id) ?? null);
  }

  async getByNumber(tenantId: string, number: string) {
    return this.read(
      (db) =>
        db.inventoryAdjustments.find(
          (item) => item.tenantId === tenantId && item.number === number,
        ) ?? null,
    );
  }

  async query(filters: Parameters<InventoryAdjustmentRepository["query"]>[0] = {}) {
    return this.read((db) =>
      db.inventoryAdjustments
        .filter(
          (item) =>
            (!filters.tenantId || item.tenantId === filters.tenantId) &&
            (!filters.branchId || item.branchId === filters.branchId) &&
            (!filters.productId || item.productId === filters.productId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async create(input: CreateInventoryAdjustmentInput) {
    const adjustment = this.store.mutate((db) => {
      this.assertValidCreateInput(db, input);
      const now = this.now();
      const delta = input.quantityAfter - input.quantityBefore;
      const created: InventoryAdjustment = {
        id: this.id("inventory-adjustment"),
        tenantId: input.tenantId,
        number: this.generateAdjustmentNumber(db, input.tenantId, now),
        branchId: input.branchId,
        productId: input.productId,
        locationId: input.locationId,
        type: input.type,
        reason: input.reason.trim(),
        notes: input.notes?.trim() || undefined,
        quantityBefore: input.quantityBefore,
        quantityAfter: input.quantityAfter,
        delta,
        performedByUserId: input.performedByUserId,
        createdAt: now,
      };
      db.inventoryAdjustments.push(created);
      return created;
    });
    this.emitChanged(adjustment);
    return adjustment;
  }

  async registerStockAdjustment(
    input: Parameters<InventoryAdjustmentRepository["registerStockAdjustment"]>[0],
  ) {
    const result = this.store.transact((db) => {
      this.assertValidCreateInput(db, input);
      const product = db.products.find((item) => item.id === input.productId)!;
      const capabilities = db.businessCapabilities.find((item) => item.tenantId === input.tenantId);
      // Sin configuracion del negocio el backend interpreta false: no se asume true.
      const usesLocations = capabilities?.supportsMultipleLocations ?? false;
      const location = db.storageLocations.find((item) => item.id === input.locationId);
      const settings = db.productInventorySettings.find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId &&
          item.productId === input.productId,
      );
      if (usesLocations && !input.locationId && !settings?.defaultLocationId) {
        // Producto heredado sin asignacion: opera su balance NULL historico (igual que el backend).
        const hasLegacyNullBalance = db.inventoryBalances.some(
          (item) =>
            item.tenantId === input.tenantId &&
            item.branchId === input.branchId &&
            item.productId === input.productId &&
            !item.locationId,
        );
        if (!hasLegacyNullBalance) {
          throw new Error("Inventory adjustment location must be the active operational location");
        }
      } else if (usesLocations) {
        if (
          !input.locationId ||
          !location ||
          location.tenantId !== input.tenantId ||
          location.branchId !== input.branchId ||
          location.status !== LocationStatus.active ||
          settings?.defaultLocationId !== input.locationId
        ) {
          throw new Error("Inventory adjustment location must be the active operational location");
        }
      } else if (input.locationId) {
        throw new Error("Inventory adjustment location must be empty when locations are disabled");
      }
      const delta = input.quantityAfter - input.quantityBefore;
      const quantity = Math.abs(delta);
      if ((product.tracking.lot || product.tracking.serial) && !Number.isInteger(quantity)) {
        throw new Error("Traceable adjustments require a whole-unit quantity");
      }
      const now = this.now();
      const balance = db.inventoryBalances.find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId &&
          item.productId === input.productId &&
          (item.locationId ?? null) === (input.locationId ?? null),
      );
      const locationQuantity = balance?.quantity ?? 0;
      const actualQuantityBefore = db.inventoryBalances
        .filter(
          (item) =>
            item.tenantId === input.tenantId &&
            item.branchId === input.branchId &&
            item.productId === input.productId &&
            (item.locationId ?? null) === (input.locationId ?? null),
        )
        .reduce((total, item) => total + item.quantity, 0);
      if (
        input.type === InventoryAdjustmentType.countCorrection &&
        input.expectedQuantity !== undefined &&
        actualQuantityBefore !== input.expectedQuantity
      ) {
        throw new Error("COUNT_SNAPSHOT_STALE: Inventory changed while the count was prepared");
      }
      // Los movimientos manuales son deltas y no llevan snapshot optimista. El mock usa el saldo
      // actual como quantityBefore, igual que la API; el conteo exacto si queda protegido arriba.
      const effectiveQuantityBefore = actualQuantityBefore;
      const effectiveQuantityAfter = effectiveQuantityBefore + delta;
      const availableLocationQuantity = locationQuantity - (balance?.reservedQuantity ?? 0);
      if (delta < 0 && quantity > availableLocationQuantity) {
        throw new Error("Insufficient stock in the selected location");
      }

      let lot: StockLot | undefined;
      if (product.tracking.lot) {
        if (delta > 0) {
          const lotNumber = input.lotNumber?.trim();
          if (!lotNumber) throw new Error("Lot number is required");
          if (product.tracking.expiration && !input.expirationDate) {
            throw new Error("Expiration date is required");
          }
          lot = db.stockLots.find(
            (item) =>
              item.tenantId === input.tenantId &&
              item.branchId === input.branchId &&
              item.productId === input.productId &&
              item.locationId === input.locationId &&
              item.lotNumber === lotNumber,
          );
          if (lot && (lot.expirationDate ?? null) !== (input.expirationDate ?? null)) {
            throw new Error("Lot metadata does not match the existing lot");
          }
          if (!lot) {
            lot = {
              id: this.id("stock-lot"),
              tenantId: input.tenantId,
              branchId: input.branchId,
              productId: input.productId,
              locationId: input.locationId,
              lotNumber,
              expirationDate: input.expirationDate,
              quantity: 0,
              createdAt: now,
            };
            db.stockLots.push(lot);
          }
        } else {
          lot = db.stockLots.find(
            (item) =>
              item.id === input.lotId &&
              item.tenantId === input.tenantId &&
              item.branchId === input.branchId &&
              item.productId === input.productId &&
              item.locationId === input.locationId,
          );
          if (!lot) throw new Error("Selected lot is not available in this location");
          if (lot.quantity < quantity) throw new Error("Selected lot has insufficient stock");
        }
      }

      const serialValues = (input.serialNumbers ?? []).map((item) => item.trim()).filter(Boolean);
      if (product.tracking.serial) {
        if (
          serialValues.length !== quantity ||
          new Set(serialValues).size !== serialValues.length
        ) {
          throw new Error(`Exactly ${quantity} unique serial numbers are required`);
        }
      } else if (serialValues.length > 0) {
        throw new Error("Serial numbers are not allowed for this product");
      }

      let serials: SerialNumber[] = [];
      if (product.tracking.serial && delta > 0) {
        serialValues.forEach((serialNumber) => {
          if (
            db.serialNumbers.some(
              (item) => item.tenantId === input.tenantId && item.serialNumber === serialNumber,
            )
          ) {
            throw new Error(`Serial number already exists: ${serialNumber}`);
          }
        });
        serials = serialValues.map((serialNumber) => ({
          id: this.id("serial"),
          tenantId: input.tenantId,
          branchId: input.branchId,
          productId: input.productId,
          locationId: input.locationId,
          lotId: lot?.id,
          serialNumber,
          status: SerialStatus.available,
          createdAt: now,
          updatedAt: now,
        }));
        db.serialNumbers.push(...serials);
      } else if (product.tracking.serial && delta < 0) {
        serials = serialValues.map((serialNumber) => {
          const serial = db.serialNumbers.find(
            (item) =>
              item.serialNumber === serialNumber &&
              item.tenantId === input.tenantId &&
              item.branchId === input.branchId &&
              item.productId === input.productId &&
              item.locationId === input.locationId &&
              (!lot || item.lotId === lot.id) &&
              item.status === SerialStatus.available,
          );
          if (!serial)
            throw new Error(`Serial number is not available in this location: ${serialNumber}`);
          return serial;
        });
        serials.forEach((serial) => {
          serial.status =
            input.type === InventoryAdjustmentType.waste ? SerialStatus.damaged : SerialStatus.sold;
          serial.updatedAt = now;
        });
      }

      if (lot) lot.quantity += delta;
      const targetBalance = balance ?? {
        id: this.id("balance"),
        tenantId: input.tenantId,
        branchId: input.branchId,
        productId: input.productId,
        locationId: input.locationId,
        quantity: 0,
        reservedQuantity: 0,
        updatedAt: now,
      };
      if (!balance) db.inventoryBalances.push(targetBalance);
      targetBalance.quantity += delta;
      targetBalance.updatedAt = now;

      const adjustment: InventoryAdjustment = {
        id: this.id("inventory-adjustment"),
        tenantId: input.tenantId,
        number: this.generateAdjustmentNumber(db, input.tenantId, now),
        branchId: input.branchId,
        productId: input.productId,
        locationId: input.locationId,
        type: input.type,
        reason: input.reason.trim(),
        notes: input.notes?.trim() || undefined,
        quantityBefore: effectiveQuantityBefore,
        quantityAfter: effectiveQuantityAfter,
        delta,
        performedByUserId: input.performedByUserId,
        createdAt: now,
      };
      db.inventoryAdjustments.push(adjustment);
      const movementType = delta > 0 ? InventoryMovementType.in : InventoryMovementType.out;
      const movementInputs =
        serials.length > 0
          ? serials.map((serial) => ({ serial, quantity: 1 }))
          : [{ serial: undefined, quantity }];
      const movements = movementInputs.map<InventoryMovement>(
        ({ serial, quantity: movementQuantity }, index) => ({
          id: this.id("movement"),
          tenantId: input.tenantId,
          branchId: input.branchId,
          productId: input.productId,
          lotId: lot?.id,
          serialNumberId: serial?.id,
          type: movementType,
          reason: input.reason.trim(),
          quantity: movementQuantity,
          quantityBefore: effectiveQuantityBefore + Math.sign(delta) * index,
          quantityAfter: effectiveQuantityBefore + Math.sign(delta) * (index + movementQuantity),
          fromLocationId: delta < 0 ? input.locationId : undefined,
          toLocationId: delta > 0 ? input.locationId : undefined,
          referenceType: "inventoryAdjustment",
          referenceId: adjustment.id,
          performedByUserId: input.performedByUserId,
          createdAt: now,
        }),
      );
      db.inventoryMovements.push(...movements);
      return { adjustment, movements };
    });
    this.emitChanged(result.adjustment);
    result.movements.forEach((movement) =>
      this.emit("inventory.changed", {
        entityId: movement.id,
        tenantId: movement.tenantId,
        branchId: movement.branchId,
        productId: movement.productId,
        action: "created",
      }),
    );
    return result;
  }

  private assertValidCreateInput(db: MockDatabase, input: CreateInventoryAdjustmentInput): void {
    const tenant = db.tenants.find((item) => item.id === input.tenantId);
    if (!tenant) throw this.missing("Tenant", input.tenantId);

    const branch = db.branches.find((item) => item.id === input.branchId);
    if (!branch) throw this.missing("Branch", input.branchId);
    if (branch.tenantId !== input.tenantId) {
      throw new Error("Inventory adjustment branch must match adjustment tenant");
    }

    const product = db.products.find((item) => item.id === input.productId);
    if (!product) throw this.missing("Product", input.productId);
    if (product.tenantId !== input.tenantId) {
      throw new Error("Inventory adjustment product must match adjustment tenant");
    }

    const capabilities = db.businessCapabilities.find((item) => item.tenantId === input.tenantId);
    const usesLocations = capabilities?.supportsMultipleLocations ?? false;
    if (usesLocations && input.locationId) {
      const location = db.storageLocations.find((item) => item.id === input.locationId);
      if (!location) throw this.missing("StorageLocation", input.locationId);
      if (
        location.tenantId !== input.tenantId ||
        location.branchId !== input.branchId ||
        location.status !== LocationStatus.active
      ) {
        throw new Error("Inventory adjustment location must match adjustment tenant and branch");
      }
    } else if (input.locationId) {
      throw new Error("Inventory adjustment location must be empty when locations are disabled");
    }

    if (input.performedByUserId) {
      const user = db.users.find((item) => item.id === input.performedByUserId);
      if (!user) throw this.missing("User", input.performedByUserId);
      if (user.tenantId !== input.tenantId) {
        throw new Error("Inventory adjustment user must match adjustment tenant");
      }
    }

    this.assertQuantity(input.quantityBefore, "quantityBefore");
    this.assertQuantity(input.quantityAfter, "quantityAfter");
    this.assertDelta(input);

    if (!input.reason.trim()) {
      throw new Error("Inventory adjustment reason is required");
    }
  }

  private assertQuantity(value: number, field: string): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Inventory adjustment ${field} must be greater than or equal to 0`);
    }
  }

  private assertDelta(input: CreateInventoryAdjustmentInput): void {
    const delta = input.quantityAfter - input.quantityBefore;
    if (delta === 0) {
      throw new Error("Inventory adjustment delta must be different from 0");
    }
    if (input.type === InventoryAdjustmentType.manualIncrease && delta <= 0) {
      throw new Error("Inventory adjustment manualIncrease requires a positive delta");
    }
    if (
      (input.type === InventoryAdjustmentType.manualDecrease ||
        input.type === InventoryAdjustmentType.waste) &&
      delta >= 0
    ) {
      throw new Error("Inventory adjustment decrease types require a negative delta");
    }
  }

  private generateAdjustmentNumber(db: MockDatabase, tenantId: string, date: string): string {
    const year = new Date(date).getFullYear();
    const prefix = `AJ-${year}-`;
    const next =
      db.inventoryAdjustments
        .filter(
          (adjustment) => adjustment.tenantId === tenantId && adjustment.number.startsWith(prefix),
        )
        .map((adjustment) => Number(adjustment.number.slice(prefix.length)))
        .filter((value) => Number.isInteger(value))
        .reduce((max, value) => Math.max(max, value), 0) + 1;
    return `${prefix}${String(next).padStart(5, "0")}`;
  }

  private emitChanged(adjustment: InventoryAdjustment): void {
    this.emit("inventory-adjustment.changed", {
      entityId: adjustment.id,
      tenantId: adjustment.tenantId,
      branchId: adjustment.branchId,
      productId: adjustment.productId,
      action: "created",
      metadata: {
        number: adjustment.number,
        type: adjustment.type,
        delta: adjustment.delta,
        locationId: adjustment.locationId,
      },
    });
  }
}
