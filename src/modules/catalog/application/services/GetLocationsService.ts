import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { LocationListItem } from "@/modules/catalog/application/dto/LocationEditorDto";
import {
  ensureCanReadLocations,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class GetLocationsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(branchId?: string): Promise<LocationListItem[]> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanReadLocations(permissions);
    // Una sola lectura (paginada en el backend) con el conteo de productos asignados por ubicacion:
    // nunca una consulta por producto.
    const entries = await this.repositories.inventory.getLocationsWithCounts(branchId);
    const scoped = entries.filter(({ location }) => location.tenantId === tenantId);

    const locationNames = new Map(scoped.map(({ location }) => [location.id, location.name]));
    const items = scoped.map(({ location, assignedProductCount }) => ({
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
      productCount: assignedProductCount,
    }));
    return flattenLocationHierarchy(items);
  }
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
