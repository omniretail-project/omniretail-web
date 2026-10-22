import type { Category } from "@/core/entities";
import type { CategoryProductCounts } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { CategoryListItem } from "@/modules/catalog/application/dto/CategoryEditorDto";
import {
  ensureCanReadCategories,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class GetCategoriesService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(): Promise<CategoryListItem[]> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanReadCategories(permissions);
    // Una sola lectura con los conteos reales (sin cargar el catalogo ni consultar por categoria).
    const entries = await this.repositories.categories.getByTenantWithCounts(tenantId);
    const categoryNames = new Map(entries.map(({ category }) => [category.id, category.name]));

    return flattenCategoryHierarchy(
      entries.map(({ category, counts }) => toListItem(category, categoryNames, counts)),
    );
  }
}

function toListItem(
  category: Category,
  categoryNames: Map<string, string>,
  counts: CategoryProductCounts,
): CategoryListItem {
  return {
    id: category.id,
    tenantId: category.tenantId,
    parentId: category.parentId,
    parentName: category.parentId ? categoryNames.get(category.parentId) : undefined,
    depth: 0,
    name: category.name,
    code: category.slug.toUpperCase(),
    slug: category.slug,
    description: category.description,
    image: category.image,
    status: category.status,
    productCount: counts.productCount,
    archivedProductCount: counts.archivedProductCount,
  };
}

function flattenCategoryHierarchy(categories: CategoryListItem[]) {
  const byParent = new Map<string | undefined, CategoryListItem[]>();
  categories.forEach((category) => {
    const siblings = byParent.get(category.parentId) ?? [];
    siblings.push(category);
    byParent.set(category.parentId, siblings);
  });
  byParent.forEach((siblings) =>
    siblings.sort((left, right) => left.name.localeCompare(right.name)),
  );

  const result: CategoryListItem[] = [];
  const visited = new Set<string>();
  const visit = (category: CategoryListItem, depth: number) => {
    if (visited.has(category.id)) return;
    visited.add(category.id);
    result.push({ ...category, depth });
    (byParent.get(category.id) ?? []).forEach((child) => visit(child, depth + 1));
  };

  (byParent.get(undefined) ?? []).forEach((root) => visit(root, 0));
  categories.forEach((category) => visit(category, 0));
  return result;
}
