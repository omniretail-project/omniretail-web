import type { Product, Unit, UnitConversion } from "@/core/entities";
import { UnitCategory } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { UnitListItem } from "@/modules/catalog/application/dto/UnitEditorDto";
import { isApiMode } from "@/config/api-mode";
import {
  ensureCanReadUnits,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export const UNIT_CATEGORY_LABELS: Record<UnitCategory, string> = {
  [UnitCategory.unit]: "Unidad",
  [UnitCategory.weight]: "Peso",
  [UnitCategory.length]: "Longitud",
  [UnitCategory.volume]: "Volumen",
  [UnitCategory.other]: "Otra",
};

export class GetUnitsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(): Promise<UnitListItem[]> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanReadUnits(permissions);
    const [units, products, flatConversions] = await Promise.all([
      this.repositories.units.getByTenant(tenantId),
      isApiMode() ? Promise.resolve([]) : this.repositories.products.getByTenant(tenantId),
      this.repositories.units.getAllConversionsByTenant(tenantId),
    ]);

    return units
      .map((unit) => toListItem(unit, products, flatConversions))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

function toListItem(unit: Unit, products: Product[], conversions: UnitConversion[]): UnitListItem {
  const productIds = new Set<string>();
  products.forEach((product) => {
    if (product.baseUnitId === unit.id || product.saleUnitId === unit.id) {
      productIds.add(product.id);
    }
  });

  const conversionIds = new Set<string>();
  conversions.forEach((conversion) => {
    if (conversion.fromUnitId === unit.id || conversion.toUnitId === unit.id) {
      conversionIds.add(conversion.id);
      if (conversion.productId) productIds.add(conversion.productId);
    }
  });

  return {
    id: unit.id,
    tenantId: unit.tenantId,
    code: unit.code,
    name: unit.name,
    symbol: unit.symbol,
    category: unit.category,
    categoryLabel: UNIT_CATEGORY_LABELS[unit.category],
    allowsDecimals: unit.allowsDecimals,
    status: unit.status,
    productReferenceCount: productIds.size,
    conversionReferenceCount: conversionIds.size,
  };
}
