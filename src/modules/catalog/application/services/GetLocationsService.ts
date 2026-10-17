import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { LocationListItem } from "@/modules/catalog/application/dto/LocationEditorDto";
import { isApiMode } from "@/config/api-mode";
import {
  ensureCanReadLocations,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class GetLocationsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(branchId?: string): Promise<LocationListItem[]> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanReadLocations(permissions);
    const [locations, products] = await Promise.all([
      this.repositories.inventory.getLocations(branchId),
      isApiMode() ? Promise.resolve([]) : this.repositories.products.getByTenant(tenantId),
    ]);
    const productCounts = isApiMode()
      ? null
      : branchId
        ? await countProductsByDefaultLocation(
            this.repositories,
            products.map((product) => product.id),
            branchId,
          )
        : new Map<string, number>();

    const locationNames = new Map(locations.map((location) => [location.id, location.name]));
    const items = locations
      .filter((location) => location.tenantId === tenantId)
      .map((location) => ({
        id: location.id,
        tenantId: location.tenantId,
        branchId: location.branchId,
        parentId: location.parentId,
        parentName: location.parentId ? locationNames.get(location.parentId) : undefined,
        code: location.code,
        name: location.name,
        type: location.type,
        depth: 0,
        description: location.description,
        status: location.status,
        productCount: productCounts ? (productCounts.get(location.id) ?? 0) : null,
      }));
    return flattenLocationHierarchy(items);
  }
}

async function countProductsByDefaultLocation(
  repositories: RepositoryRegistry,
  productIds: string[],
  branchId: string,
) {
  const productIdsByLocation = new Map<string, Set<string>>();

  const settings = await Promise.all(
    productIds.map((productId) =>
      repositories.inventory.getProductInventorySettings(productId, branchId),
    ),
  );

  settings.forEach((setting) => {
    if (!setting?.defaultLocationId) return;
    const locationProductIds =
      productIdsByLocation.get(setting.defaultLocationId) ?? new Set<string>();
    locationProductIds.add(setting.productId);
    productIdsByLocation.set(setting.defaultLocationId, locationProductIds);
  });

  return new Map(
    [...productIdsByLocation.entries()].map(([locationId, locationProductIds]) => [
      locationId,
      locationProductIds.size,
    ]),
  );
}

function flattenLocationHierarchy(locations: LocationListItem[]) {
  const byParent = new Map<string | undefined, LocationListItem[]>();
  locations.forEach((location) => {
    const siblings = byParent.get(location.parentId) ?? [];
    siblings.push(location);
    byParent.set(location.parentId, siblings);
  });
  byParent.forEach((siblings) =>
    siblings.sort((left, right) => left.name.localeCompare(right.name)),
  );

  const result: LocationListItem[] = [];
  const visited = new Set<string>();
  const visit = (location: LocationListItem, depth: number) => {
    if (visited.has(location.id)) return;
    visited.add(location.id);
    result.push({ ...location, depth });
    (byParent.get(location.id) ?? []).forEach((child) => visit(child, depth + 1));
  };

  (byParent.get(undefined) ?? []).forEach((root) => visit(root, 0));
  locations.forEach((location) => visit(location, 0));
  return result;
}
