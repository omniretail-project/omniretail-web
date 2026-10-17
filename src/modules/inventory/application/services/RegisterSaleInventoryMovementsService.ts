import type { InventoryMovement, Sale, SaleItem } from "@/core/entities";
import { InventoryMovementType, ProductType } from "@/core/enums";
import { planInventoryAllocation } from "@/core/inventory/stockAvailability";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export interface RegisterSaleInventoryMovementItemInput {
  saleItem: SaleItem;
  sourceLocationId?: string;
}

export interface RegisterSaleInventoryMovementsInput {
  sale: Sale;
  items?: RegisterSaleInventoryMovementItemInput[];
  reason?: string;
}

export interface RegisterSaleInventoryMovementsResult {
  movements: InventoryMovement[];
  skippedItemIds: string[];
}

export class RegisterSaleInventoryMovementsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    input: RegisterSaleInventoryMovementsInput,
  ): Promise<RegisterSaleInventoryMovementsResult> {
    const items: RegisterSaleInventoryMovementItemInput[] =
      input.items ??
      input.sale.items.map((saleItem) => ({
        saleItem,
      }));
    const skippedItemIds: string[] = [];
    const plannedMovements: PlannedSaleInventoryMovement[] = [];
    const plannedQuantities = new Map<string, number>();

    for (const item of items) {
      if (!Number.isFinite(item.saleItem.quantity) || item.saleItem.quantity <= 0) {
        throw new Error(`Cantidad invalida para el item ${item.saleItem.id}.`);
      }

      const product = await this.repositories.products.getById(item.saleItem.productId);
      if (!product) {
        throw new Error(`Producto no encontrado para el item ${item.saleItem.id}.`);
      }
      if (product.productType !== ProductType.physical || !product.tracking.stock) {
        skippedItemIds.push(item.saleItem.id);
        continue;
      }
      if (product.tracking.lot || product.tracking.serial) {
        throw new Error(
          `La venta ${input.sale.number} contiene ${product.name} con trazabilidad pendiente de lote/serie.`,
        );
      }

      const balances = await this.repositories.inventory.getBalanceByProduct(
        product.id,
        input.sale.branchId,
      );
      const settings = await this.repositories.inventory.getProductInventorySettings(
        product.id,
        input.sale.branchId,
      );
      const locations = await this.repositories.inventory.getLocations(input.sale.branchId);
      const allocations = planInventoryAllocation({
        tenantId: input.sale.tenantId,
        branchId: input.sale.branchId,
        productId: product.id,
        quantity: item.saleItem.quantity,
        balances: balances.map((balance) => {
          const plannedQuantity = plannedQuantities.get(balance.id);
          return plannedQuantity === undefined
            ? balance
            : { ...balance, quantity: plannedQuantity };
        }),
        locations,
        preferredLocationId: item.sourceLocationId ?? settings?.defaultLocationId,
      });
      if (
        item.sourceLocationId &&
        allocations.some((allocation) => allocation.locationId !== item.sourceLocationId)
      ) {
        throw new Error(`Stock insuficiente para ${product.name} en la ubicacion indicada.`);
      }
      if (allocations.length === 0) {
        throw new Error(`Stock insuficiente para ${product.name}.`);
      }

      allocations.forEach((allocation) => {
        plannedQuantities.set(allocation.balanceId, allocation.quantityAfter);
        plannedMovements.push({
          productId: product.id,
          quantity: allocation.quantity,
          quantityBefore: allocation.quantityBefore,
          quantityAfter: allocation.quantityAfter,
          fromLocationId: allocation.locationId,
        });
      });
    }

    const existingMovements = (await this.repositories.inventory.getMovements()).filter(
      (movement) => movement.referenceType === "sale" && movement.referenceId === input.sale.id,
    );
    if (existingMovements.length > 0) {
      if (this.matchesExistingMovements(plannedMovements, existingMovements)) {
        return { movements: existingMovements, skippedItemIds };
      }
      throw new Error(
        `La venta ${input.sale.number} ya tiene movimientos de inventario parciales o inconsistentes.`,
      );
    }

    const movements: InventoryMovement[] = [];
    for (const planned of plannedMovements) {
      movements.push(
        await this.repositories.inventory.registerMovement({
          tenantId: input.sale.tenantId,
          branchId: input.sale.branchId,
          productId: planned.productId,
          type: InventoryMovementType.out,
          reason: input.reason ?? `Venta ${input.sale.number}`,
          quantity: planned.quantity,
          quantityBefore: planned.quantityBefore,
          quantityAfter: planned.quantityAfter,
          fromLocationId: planned.fromLocationId,
          referenceType: "sale",
          referenceId: input.sale.id,
          performedByUserId: input.sale.createdByUserId,
        }),
      );
    }

    return { movements, skippedItemIds };
  }

  private matchesExistingMovements(
    plannedMovements: PlannedSaleInventoryMovement[],
    existingMovements: InventoryMovement[],
  ) {
    if (plannedMovements.length !== existingMovements.length) return false;
    const remaining = [...existingMovements];

    return plannedMovements.every((planned) => {
      const index = remaining.findIndex(
        (movement) =>
          movement.type === InventoryMovementType.out &&
          movement.productId === planned.productId &&
          movement.quantity === planned.quantity &&
          movement.fromLocationId === planned.fromLocationId,
      );
      if (index < 0) return false;
      remaining.splice(index, 1);
      return true;
    });
  }
}

interface PlannedSaleInventoryMovement {
  productId: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  fromLocationId?: string;
}
