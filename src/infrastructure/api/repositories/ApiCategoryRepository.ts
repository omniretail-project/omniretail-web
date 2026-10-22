import { CategoryStatus } from "@/core/enums";
import type { Category } from "@/core/entities";
import type { CategoryRepository } from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { ApiCategory } from "@/infrastructure/api/repositories/catalogMasterDataApi";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import {
  isBackendManagedMediaUrl,
  toBackendMediaUrl,
  toSameOriginMediaUrl,
} from "@/infrastructure/api/mediaUrl";

type CategoryWrite = Omit<Category, "id" | "createdAt" | "updatedAt">;

export class ApiCategoryRepository implements CategoryRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async getAll() {
    return this.list();
  }

  async getByTenant(_tenantId: string) {
    void _tenantId;
    return this.list();
  }

  async getByTenantWithCounts(_tenantId: string) {
    void _tenantId;
    const categories = await this.fetchList(undefined, true);
    return categories.map((category) => ({
      category: toCategory(category),
      counts: {
        productCount: toCount(category.productCount),
        archivedProductCount: toCount(category.archivedProductCount),
      },
    }));
  }

  async getById(id: string) {
    assertApiUuid(id, "categoryId");
    try {
      return toCategory(await backendFetch<ApiCategory>(`/catalog/categories/${id}`));
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async getByIdScoped(_tenantId: string, id: string) {
    return this.getById(id);
  }

  async getActive() {
    return this.list(CategoryStatus.active);
  }

  async getActiveByTenant(_tenantId: string) {
    void _tenantId;
    return this.list(CategoryStatus.active);
  }

  async create(input: CategoryWrite) {
    assertOptionalApiUuid(input.parentId, "parentId");
    const category = toCategory(
      await backendFetch<ApiCategory>("/catalog/categories", {
        method: "POST",
        body: toRequest(input),
      }),
    );
    this.emit(category, "created");
    return category;
  }

  async update(id: string, input: Partial<CategoryWrite>) {
    assertApiUuid(id, "categoryId");
    assertOptionalApiUuid(input.parentId, "parentId");
    const current = await this.getById(id);
    if (!current)
      throw new BackendRequestError("Categoría no encontrada.", 404, "CATEGORY_NOT_FOUND");
    const category = toCategory(
      await backendFetch<ApiCategory>(`/catalog/categories/${id}`, {
        method: "PUT",
        body: toRequest({ ...current, ...input }),
      }),
    );
    this.emit(category, "updated");
    return category;
  }

  async updateScoped(
    _tenantId: string,
    id: string,
    input: Partial<Omit<CategoryWrite, "tenantId">>,
  ) {
    return this.update(id, input);
  }

  async uploadImage(id: string, file: Blob) {
    assertApiUuid(id, "categoryId");
    const form = new FormData();
    form.append("file", file, categoryImageFilename(file.type));
    const category = toCategory(
      await backendFetch<ApiCategory>(`/catalog/categories/${id}/image`, {
        method: "POST",
        body: form,
      }),
    );
    this.emit(category, "updated");
    return category;
  }

  async removeImage(id: string) {
    assertApiUuid(id, "categoryId");
    const category = toCategory(
      await backendFetch<ApiCategory>(`/catalog/categories/${id}/image`, {
        method: "DELETE",
      }),
    );
    this.emit(category, "updated");
    return category;
  }

  async archive(id: string) {
    assertApiUuid(id, "categoryId");
    const current = await this.getById(id);
    if (!current)
      throw new BackendRequestError("Categoría no encontrada.", 404, "CATEGORY_NOT_FOUND");
    await backendFetch<void>(`/catalog/categories/${id}`, { method: "DELETE" });
    const category = { ...current, status: CategoryStatus.archived };
    this.emit(category, "archived");
    return category;
  }

  async archiveScoped(_tenantId: string, id: string) {
    return this.archive(id);
  }

  private async list(status?: CategoryStatus) {
    return (await this.fetchList(status, false)).map(toCategory);
  }

  private fetchList(status: CategoryStatus | undefined, includeCounts: boolean) {
    return backendFetch<ApiCategory[]>("/catalog/categories", {
      query: { status, includeCounts: includeCounts ? true : undefined },
    });
  }

  private emit(category: Category, action: "created" | "updated" | "archived") {
    this.eventBus.emit("category.changed", {
      entityId: category.id,
      tenantId: category.tenantId,
      action,
    });
  }
}

/** Solo un entero no negativo es un conteo; cualquier otra cosa es "no disponible", nunca cero. */
function toCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function toCategory(category: ApiCategory): Category {
  // Los conteos viajan aparte (getByTenantWithCounts); no forman parte de la entidad Category.
  const {
    imageUrl,
    parentId,
    description,
    productCount: _productCount,
    archivedProductCount: _archivedProductCount,
    ...rest
  } = category;
  void _productCount;
  void _archivedProductCount;
  const safeImageUrl =
    imageUrl && (isBackendManagedMediaUrl(imageUrl) || /^https?:\/\//i.test(imageUrl))
      ? toSameOriginMediaUrl(imageUrl)
      : undefined;
  return {
    ...rest,
    parentId: parentId ?? undefined,
    description: description ?? undefined,
    image: safeImageUrl ? { kind: "url", src: safeImageUrl } : undefined,
  };
}

function toRequest(category: CategoryWrite) {
  return {
    parentId: category.parentId || null,
    name: category.name,
    slug: category.slug,
    description: category.description ?? null,
    imageUrl:
      category.image?.kind === "url" ? toBackendMediaUrl(category.image.src) : null,
    status: category.status,
  };
}

function categoryImageFilename(mimeType: string) {
  const extension =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `category-image.${extension}`;
}
