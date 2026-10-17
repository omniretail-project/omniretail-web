import type { ProductMedia } from "@/core/entities";
import type { ProductMediaRepository } from "@/core/repositories";
import type { ProductRepository } from "@/core/repositories/ProductRepository";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import {
  isBackendManagedMediaUrl,
  toBackendMediaUrl,
  toSameOriginMediaUrl,
} from "@/infrastructure/api/mediaUrl";
import {
  apiProductMediaListSchema,
  apiProductMediaSchema,
  type ApiProductMedia,
} from "@/infrastructure/api/repositories/productMediaApi.schema";
import { parseApi } from "@/infrastructure/api/repositories/productRelationsApi.schema";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";

export class ApiProductMediaRepository implements ProductMediaRepository {
  constructor(
    private readonly products: ProductRepository,
    private readonly eventBus: DataEventBus,
  ) {}

  async getByProduct(productId: string, knownTenantId?: string): Promise<ProductMedia[]> {
    assertApiUuid(productId, "productId");
    const tenantId = knownTenantId ?? (await this.requireProductTenant(productId));
    const items = parseApi(
      apiProductMediaListSchema,
      await backendFetch<unknown>(this.basePath(productId)),
      "El backend devolvió multimedia de producto inválida.",
    );
    this.assertProductOwnership(items, productId);
    return items.map((item) => toProductMedia(item, tenantId));
  }

  async getPrimaryByProduct(productId: string, tenantId?: string) {
    const items = await this.getByProduct(productId, tenantId);
    return (
      items.find((item) => item.type === "image" && item.isPrimary) ??
      items.find((item) => item.type === "image") ??
      null
    );
  }

  async getByAssetId(_tenantId: string, _assetId: string): Promise<ProductMedia[]> {
    void _tenantId;
    void _assetId;
    throw unsupportedMockAssetOperation();
  }

  async add(input: Parameters<ProductMediaRepository["add"]>[0]) {
    assertApiUuid(input.productId, "productId");
    const backendUrl = toBackendMediaUrl(input.url || getUrlSource(input));
    if (!/^https?:\/\//i.test(backendUrl)) {
      throw new BackendRequestError(
        "La multimedia externa debe usar una URL http(s).",
        400,
        "PRODUCT_MEDIA_URL_INVALID",
      );
    }
    const item = this.parseOne(
      await backendFetch<unknown>(this.basePath(input.productId), {
        method: "POST",
        body: {
          type: input.type,
          url: backendUrl,
          altText: input.alt ?? null,
          sortOrder: input.sortOrder,
          primary: input.isPrimary,
        },
      }),
      input.productId,
    );
    const media = toProductMedia(item, input.tenantId);
    this.emit(media);
    return media;
  }

  async uploadForProduct(
    productId: string,
    input: Parameters<ProductMediaRepository["uploadForProduct"]>[1],
  ) {
    assertApiUuid(productId, "productId");
    const form = new FormData();
    form.append("file", input.file, uploadFilename(input.file.type));
    if (input.alt !== undefined) form.append("altText", input.alt);
    if (input.sortOrder !== undefined) form.append("sortOrder", String(input.sortOrder));
    if (input.isPrimary !== undefined) form.append("primary", String(input.isPrimary));
    const item = this.parseOne(
      await backendFetch<unknown>(`${this.basePath(productId)}/upload`, {
        method: "POST",
        body: form,
      }),
      productId,
    );
    const media = toProductMedia(item, input.tenantId);
    this.emit(media);
    return media;
  }

  async update(media: ProductMedia) {
    assertApiUuid(media.productId, "productId");
    assertApiUuid(media.id, "mediaId");
    const backendUrl = toBackendMediaUrl(media.url || getUrlSource(media));
    const managed = isBackendManagedMediaUrl(backendUrl);
    const item = this.parseOne(
      await backendFetch<unknown>(`${this.basePath(media.productId)}/${media.id}`, {
        method: "PUT",
        body: {
          ...(managed ? {} : { url: backendUrl }),
          altText: media.alt ?? null,
          sortOrder: media.sortOrder,
        },
      }),
      media.productId,
    );
    const updated = toProductMedia(item, media.tenantId);
    this.emit(updated);
    return updated;
  }

  async removeFromProduct(productId: string, mediaId: string) {
    assertApiUuid(productId, "productId");
    assertApiUuid(mediaId, "mediaId");
    const tenantId = await this.requireProductTenant(productId);
    await backendFetch<void>(`${this.basePath(productId)}/${mediaId}`, { method: "DELETE" });
    this.eventBus.emit("product.changed", {
      entityId: productId,
      tenantId,
      productId,
      action: "updated",
    });
  }

  async remove(_id: string): Promise<void> {
    void _id;
    throw new BackendRequestError(
      "Product Media API requiere productId para eliminar multimedia.",
      400,
      "PRODUCT_MEDIA_OWNER_REQUIRED",
    );
  }

  async setPrimary(productId: string, mediaId: string) {
    assertApiUuid(productId, "productId");
    assertApiUuid(mediaId, "mediaId");
    const tenantId = await this.requireProductTenant(productId);
    const item = this.parseOne(
      await backendFetch<unknown>(`${this.basePath(productId)}/${mediaId}/primary`, {
        method: "PUT",
      }),
      productId,
    );
    this.emit(toProductMedia(item, tenantId));
  }

  private basePath(productId: string) {
    return `/catalog/products/${productId}/media`;
  }

  private parseOne(value: unknown, productId: string) {
    const item = parseApi(
      apiProductMediaSchema,
      value,
      "El backend devolvió multimedia de producto inválida.",
    );
    this.assertProductOwnership([item], productId);
    return item;
  }

  private assertProductOwnership(items: ApiProductMedia[], productId: string) {
    if (items.some((item) => item.productId !== productId)) {
      throw new BackendRequestError(
        "El backend devolvió multimedia de otro producto.",
        502,
        "INVALID_BACKEND_RESPONSE",
      );
    }
  }

  private async requireProductTenant(productId: string) {
    const product = await this.products.getById(productId);
    if (!product) {
      throw new BackendRequestError("Producto no encontrado.", 404, "PRODUCT_NOT_FOUND");
    }
    return product.tenantId;
  }

  private emit(media: ProductMedia) {
    this.eventBus.emit("product.changed", {
      entityId: media.productId,
      tenantId: media.tenantId,
      productId: media.productId,
      action: "updated",
    });
  }
}

function toProductMedia(item: ApiProductMedia, tenantId: string): ProductMedia {
  const url = toSameOriginMediaUrl(item.url);
  return {
    id: item.id,
    tenantId,
    productId: item.productId,
    type: item.type,
    url,
    source: { kind: "url", src: url },
    alt: item.altText ?? undefined,
    isPrimary: item.primary,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function getUrlSource(media: Pick<ProductMedia, "source">) {
  return media.source?.kind === "url" ? media.source.src : "";
}

function uploadFilename(mimeType: string) {
  const extension =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `product-media.${extension}`;
}

function unsupportedMockAssetOperation() {
  return new BackendRequestError(
    "Los assets mock no están disponibles en Product Media API.",
    400,
    "PRODUCT_MEDIA_MOCK_ASSET_UNSUPPORTED",
  );
}
