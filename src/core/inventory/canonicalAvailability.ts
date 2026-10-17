import type {
  InventoryBalance,
  Product,
  ProductKitComponent,
  SerialNumber,
  StockLot,
  StorageLocation,
} from "@/core/entities";
import { getBranchAvailableQuantity } from "@/core/inventory/stockAvailability";

export function getCanonicalProductAvailability(input: {
  product: Product;
  tenantId: string;
  branchId: string;
  balances: InventoryBalance[];
  lots: StockLot[];
  serials: SerialNumber[];
  locations: StorageLocation[];
  at: string;
}): number {
  const { product, tenantId, branchId, balances, lots, serials, locations, at } = input;
  if (!product.tracking.stock) return 0;
  const effective = balances
    .filter((balance) => balance.productId === product.id)
    .map((balance) => {
      let capacity = balance.quantity;
      if (product.tracking.lot) {
        capacity = lots
          .filter(
            (lot) =>
              lot.productId === product.id &&
              lot.branchId === branchId &&
              lot.locationId === balance.locationId &&
              isLotEligible(lot, product.tracking.expiration, at),
          )
          .reduce(
            (sum, lot) =>
              sum +
              (product.tracking.serial
                ? Math.min(
                    lot.quantity,
                    serials.filter(
                      (serial) => serial.lotId === lot.id && serial.status === "available",
                    ).length,
                  )
                : lot.quantity),
            0,
          );
      } else if (product.tracking.serial) {
        capacity = serials.filter(
          (serial) =>
            serial.tenantId === tenantId &&
            serial.branchId === branchId &&
            serial.productId === product.id &&
            serial.locationId === balance.locationId &&
            serial.status === "available",
        ).length;
      }
      return { ...balance, quantity: Math.min(balance.quantity, capacity) };
    });
  return getBranchAvailableQuantity({
    tenantId,
    branchId,
    productId: product.id,
    balances: effective,
    locations,
  });
}

export function getCanonicalKitAvailability(input: {
  components: Pick<ProductKitComponent, "componentProductId" | "quantityPerKit">[];
  componentAvailability: ReadonlyMap<string, number>;
}): number {
  const { components, componentAvailability } = input;
  if (components.length === 0) return 0;

  return Math.min(
    ...components.map((component) =>
      Math.floor(
        (componentAvailability.get(component.componentProductId) ?? 0) / component.quantityPerKit,
      ),
    ),
  );
}

function isLotEligible(lot: StockLot, expirationTracked: boolean, at: string) {
  if (!expirationTracked || !lot.expirationDate) return true;
  return (
    new Date(lot.expirationDate).getTime() >= new Date(at.slice(0, 10) + "T00:00:00.000Z").getTime()
  );
}
