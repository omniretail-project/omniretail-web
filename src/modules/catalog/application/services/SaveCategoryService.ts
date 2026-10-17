import { CategoryStatus } from "@/core/enums";
import type { Category } from "@/core/entities";
import {
  isBackendManagedMediaUrl,
  toBackendMediaUrl,
} from "@/infrastructure/api/mediaUrl";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { CategoryEditorDto } from "@/modules/catalog/application/dto/CategoryEditorDto";
import {
  CatalogServiceError,
  ensureCanManageCategories,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";
import { normalizeCategoryCode } from "@/modules/catalog/validation/category.validation";
import { removeAssetIfOrphaned } from "@/modules/catalog/application/services/productEditorHelpers";
import { CategoryImagePartialSaveError } from "@/modules/catalog/application/services/CategoryImagePartialSaveError";

export class SaveCategoryService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async create(dto: CategoryEditorDto): Promise<Category> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageCategories(permissions);
    if (!tenantId) throw new CatalogServiceError("No se pudo resolver el negocio activo.");

    await this.assertParentOwnership(tenantId, dto.parentId);
    if (this.repositories.productMediaDataSource === "api") {
      return this.createApiCategory(tenantId, dto);
    }
    await this.assertExistingImageOwnership(tenantId, dto);
    const newAssetId = await this.storePendingImage(tenantId, dto);
    try {
      return await this.repositories.categories.create({
        tenantId,
        parentId: dto.parentId || undefined,
        name: dto.name.trim(),
        slug: normalizeCategoryCode(dto.code),
        description: cleanDescription(dto.description),
        image: newAssetId ? { kind: "mockAsset", assetId: newAssetId } : dto.image,
        status: dto.status,
      });
    } catch (error) {
      if (newAssetId) await this.repositories.catalogImageAssets.remove(tenantId, newAssetId);
      throw error;
    }
  }

  async update(categoryId: string, dto: CategoryEditorDto): Promise<Category> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageCategories(permissions);
    const current = await this.repositories.categories.getByIdScoped(tenantId, categoryId);
    if (!current) {
      throw new CatalogServiceError("No se pudo resolver la categoria actual.");
    }
    await this.assertParentOwnership(tenantId, dto.parentId, categoryId);
    if (this.repositories.productMediaDataSource === "api") {
      return this.updateApiCategory(tenantId, current, dto);
    }
    await this.assertExistingImageOwnership(tenantId, dto);
    const newAssetId = await this.storePendingImage(tenantId, dto);
    const previousAssetId = current.image?.kind === "mockAsset" ? current.image.assetId : undefined;
    let updated: Category;
    try {
      updated = await this.repositories.categories.updateScoped(tenantId, categoryId, {
        parentId: dto.parentId || undefined,
        name: dto.name.trim(),
        slug: normalizeCategoryCode(dto.code),
        description: cleanDescription(dto.description),
        image: dto.removeImage
          ? undefined
          : newAssetId
            ? { kind: "mockAsset", assetId: newAssetId }
            : dto.image,
        status: dto.status,
      });
    } catch (error) {
      if (newAssetId) await this.repositories.catalogImageAssets.remove(tenantId, newAssetId);
      throw error;
    }
    const updatedAssetId = updated.image?.kind === "mockAsset" ? updated.image.assetId : undefined;
    if (previousAssetId && previousAssetId !== updatedAssetId) {
      await removeAssetIfOrphaned(this.repositories, tenantId, previousAssetId);
    }
    return updated;
  }

  private async createApiCategory(tenantId: string, dto: CategoryEditorDto) {
    this.assertApiImageSource(dto);
    const created = await this.repositories.categories.create({
      tenantId,
      parentId: dto.parentId || undefined,
      name: dto.name.trim(),
      slug: normalizeCategoryCode(dto.code),
      description: cleanDescription(dto.description),
      image: dto.pendingImage ? undefined : dto.image,
      status: dto.status,
    });
    if (!dto.pendingImage) return created;
    try {
      return await this.repositories.categories.uploadImage(created.id, dto.pendingImage.blob);
    } catch (error) {
      const canonical =
        (await this.repositories.categories.getByIdScoped(tenantId, created.id).catch(() => null)) ??
        created;
      throw new CategoryImagePartialSaveError(canonical, error);
    }
  }

  private async updateApiCategory(
    tenantId: string,
    current: Category,
    dto: CategoryEditorDto,
  ) {
    this.assertApiImageSource(dto);
    const updated = await this.repositories.categories.updateScoped(tenantId, current.id, {
      parentId: dto.parentId || undefined,
      name: dto.name.trim(),
      slug: normalizeCategoryCode(dto.code),
      description: cleanDescription(dto.description),
      image: dto.pendingImage || dto.removeImage ? current.image : dto.image,
      status: dto.status,
    });
    try {
      if (dto.pendingImage) {
        return await this.repositories.categories.uploadImage(current.id, dto.pendingImage.blob);
      }
      if (dto.removeImage) {
        return await this.repositories.categories.removeImage(current.id);
      }
      return updated;
    } catch (error) {
      const canonical =
        (await this.repositories.categories.getByIdScoped(tenantId, current.id).catch(() => null)) ??
        updated;
      throw new CategoryImagePartialSaveError(canonical, error);
    }
  }

  private assertApiImageSource(dto: CategoryEditorDto) {
    if (dto.image?.kind === "mockAsset") {
      throw new CatalogServiceError("Una imagen mock no puede enviarse a Category API.");
    }
    if (dto.image?.kind === "url") {
      const backendUrl = toBackendMediaUrl(dto.image.src);
      if (!isBackendManagedMediaUrl(backendUrl) && !/^https?:\/\//i.test(backendUrl)) {
        throw new CatalogServiceError(
          "La imagen de categoría debe usar una URL externa http(s) válida.",
        );
      }
    }
  }

  private async storePendingImage(tenantId: string, dto: CategoryEditorDto) {
    if (!dto.pendingImage) return null;
    const id = crypto.randomUUID();
    await this.repositories.catalogImageAssets.put(
      {
        id,
        tenantId,
        mimeType: dto.pendingImage.mimeType,
        byteSize: dto.pendingImage.byteSize,
        width: dto.pendingImage.width,
        height: dto.pendingImage.height,
        createdAt: new Date().toISOString(),
      },
      dto.pendingImage.blob,
    );
    return id;
  }

  private async assertExistingImageOwnership(tenantId: string, dto: CategoryEditorDto) {
    if (dto.pendingImage || dto.removeImage || dto.image?.kind !== "mockAsset") return;
    const asset = await this.repositories.catalogImageAssets.get(tenantId, dto.image.assetId);
    if (!asset) throw new CatalogServiceError("La imagen local ya no esta disponible.");
  }

  async archive(categoryId: string): Promise<Category> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageCategories(permissions);
    return this.repositories.categories.archiveScoped(tenantId, categoryId);
  }

  private async assertParentOwnership(tenantId: string, parentId?: string, categoryId?: string) {
    if (!parentId) return;
    if (parentId === categoryId) {
      throw new CatalogServiceError("Una categoria no puede ser su propia categoria padre.");
    }
    if (!(await this.repositories.categories.getByIdScoped(tenantId, parentId))) {
      throw new CatalogServiceError("La categoria padre no esta disponible.");
    }
  }

  async restore(categoryId: string): Promise<Category> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageCategories(permissions);
    return this.repositories.categories.updateScoped(tenantId, categoryId, {
      status: CategoryStatus.active,
    });
  }
}

function cleanDescription(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}
