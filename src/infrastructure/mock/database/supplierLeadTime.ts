import type { SupplierProduct } from "@/core/entities";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";

export function getSupplierLeadTimeDays(
  supplierId: string,
  supplierProducts: readonly Pick<SupplierProduct, "supplierId" | "leadTimeDays" | "active">[],
): number | undefined {
  const values = supplierProducts
    .filter(
      (supplierProduct) => supplierProduct.supplierId === supplierId && supplierProduct.active,
    )
    .map((supplierProduct) => supplierProduct.leadTimeDays)
    .filter((value) => Number.isFinite(value));

  return values.length > 0 ? Math.max(...values) : undefined;
}

export function synchronizeSupplierLeadTimeDays(
  database: Pick<MockDatabase, "suppliers" | "supplierProducts">,
  supplierIds: Iterable<string>,
): void {
  const uniqueSupplierIds = new Set(supplierIds);

  database.suppliers.forEach((supplier) => {
    if (!uniqueSupplierIds.has(supplier.id)) return;
    supplier.leadTimeDays = getSupplierLeadTimeDays(supplier.id, database.supplierProducts);
  });
}
