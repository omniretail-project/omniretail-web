import type { ProductMedia } from "@/core/entities";
import type { ProductMediaRepository } from "@/core/repositories";
import { getProductMediaSource, selectPrimaryProductMedia } from "@/core/media/catalogImage";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockProductMediaRepository
  extends BaseMockRepository
  implements ProductMediaRepository
{
  async getByProduct(productId: string) {
    return this.read((db) =>
      db.productMedia
        .filter((item) => item.productId === productId)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    );
  }

  async getPrimaryByProduct(productId: string) {
    return this.read((db) =>
      selectPrimaryProductMedia(db.productMedia.filter((item) => item.productId === productId)),
    );
  }

  async getByAssetId(tenantId: string, assetId: string) {
    return this.read((db) =>
      db.productMedia.filter(
        (item) =>
          item.tenantId === tenantId &&
          item.source?.kind === "mockAsset" &&
          item.source.assetId === assetId,
      ),
    );
  }

  async add(input: Parameters<ProductMediaRepository["add"]>[0]) {
    if (!getProductMediaSource({ ...input, id: "validation" })) {
      throw new Error("La referencia multimedia no es segura.");
    }
    const media = this.store.mutate((db) => {
      if (input.isPrimary) {
        db.productMedia.forEach((item) => {
          if (item.productId === input.productId) item.isPrimary = false;
        });
      }

      const created = {
        ...input,
        id: this.id("product-media"),
      };
      db.productMedia.push(created);
      return created;
    });

    this.emit("product.changed", {
      entityId: media.productId,
      tenantId: media.tenantId,
      productId: media.productId,
      action: "updated",
    });
    return media;
  }

  async uploadForProduct(
    _productId: string,
    _input: Parameters<ProductMediaRepository["uploadForProduct"]>[1],
  ): Promise<ProductMedia> {
    void _productId;
    void _input;
    throw new Error(
      "El upload directo pertenece al adapter API; mock usa CatalogImageAssetRepository.",
    );
  }

  async update(media: Parameters<ProductMediaRepository["update"]>[0]) {
    if (!getProductMediaSource(media)) throw new Error("La referencia multimedia no es segura.");
    const updated = this.store.mutate((db) => {
      const index = db.productMedia.findIndex((item) => item.id === media.id);
      if (index < 0) throw this.missing("ProductMedia", media.id);

      if (media.isPrimary) {
        db.productMedia.forEach((item) => {
          if (item.productId === media.productId && item.id !== media.id) {
            item.isPrimary = false;
          }
        });
      }

      db.productMedia[index] = media;
      return media;
    });

    this.emit("product.changed", {
      entityId: updated.productId,
      tenantId: updated.tenantId,
      productId: updated.productId,
      action: "updated",
    });
    return updated;
  }

  async remove(id: string) {
    const removed = this.store.mutate((db) => {
      const media = db.productMedia.find((item) => item.id === id);
      if (!media) throw this.missing("ProductMedia", id);

      db.productMedia = db.productMedia.filter((item) => item.id !== id);

      if (media.isPrimary) {
        const nextPrimary = db.productMedia
          .filter((item) => item.productId === media.productId)
          .sort((left, right) => left.sortOrder - right.sortOrder)[0];
        if (nextPrimary) nextPrimary.isPrimary = true;
      }

      return media;
    });

    this.emit("product.changed", {
      entityId: removed.productId,
      tenantId: removed.tenantId,
      productId: removed.productId,
      action: "updated",
    });
  }

  async removeFromProduct(productId: string, mediaId: string) {
    const media = await this.read((db) =>
      db.productMedia.find((item) => item.id === mediaId && item.productId === productId),
    );
    if (!media) throw this.missing("ProductMedia", mediaId);
    await this.remove(mediaId);
  }

  async setPrimary(productId: string, mediaId: string) {
    const selected = this.store.mutate((db) => {
      const media = db.productMedia.find(
        (item) => item.id === mediaId && item.productId === productId,
      );
      if (!media) throw this.missing("ProductMedia", mediaId);

      db.productMedia.forEach((item) => {
        if (item.productId === productId) item.isPrimary = item.id === mediaId;
      });

      return media;
    });

    this.emit("product.changed", {
      entityId: productId,
      tenantId: selected.tenantId,
      productId,
      action: "updated",
    });
  }
}
