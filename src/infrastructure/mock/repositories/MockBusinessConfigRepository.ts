import type { BusinessConfigRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

const MOCK_UPLOAD_UNAVAILABLE = "La subida de archivos al servidor solo está disponible en modo API.";
export class MockBusinessConfigRepository
  extends BaseMockRepository
  implements BusinessConfigRepository
{
  async getCapabilities(tenantId: string) {
    return this.read(
      (db) => db.businessCapabilities.find((item) => item.tenantId === tenantId) ?? null,
    );
  }
  async createCapabilities(input: Parameters<BusinessConfigRepository["createCapabilities"]>[0]) {
    const created = this.store.mutate((db) => {
      db.businessCapabilities.push(input);
      return input;
    });
    this.emit("business-config.changed", { tenantId: input.tenantId, action: "created" });
    return created;
  }
  async updateCapabilities(
    tenantId: string,
    input: Parameters<BusinessConfigRepository["updateCapabilities"]>[1],
  ) {
    const updated = this.store.mutate((db) => {
      const index = db.businessCapabilities.findIndex((item) => item.tenantId === tenantId);
      if (index < 0) throw this.missing("BusinessCapabilitiesConfig", tenantId);
      db.businessCapabilities[index] = { ...db.businessCapabilities[index], ...input };
      return db.businessCapabilities[index];
    });
    this.emit("business-config.changed", { tenantId, action: "updated" });
    return updated;
  }
  async getEcommerceConfig(tenantId: string) {
    return this.read(
      (db) => db.ecommerceConfigs.find((item) => item.tenantId === tenantId) ?? null,
    );
  }
  async createEcommerceConfig(
    input: Parameters<BusinessConfigRepository["createEcommerceConfig"]>[0],
  ) {
    const created = this.store.mutate((db) => {
      const now = this.now();
      const item = { ...input, createdAt: now, updatedAt: now };
      db.ecommerceConfigs.push(item);
      return item;
    });
    this.emit("business-config.changed", { tenantId: input.tenantId, action: "created" });
    return created;
  }
  async updateEcommerceConfig(
    tenantId: string,
    input: Parameters<BusinessConfigRepository["updateEcommerceConfig"]>[1],
  ) {
    const updated = this.store.mutate((db) => {
      const index = db.ecommerceConfigs.findIndex((item) => item.tenantId === tenantId);
      if (index < 0) throw this.missing("EcommerceConfig", tenantId);
      db.ecommerceConfigs[index] = {
        ...db.ecommerceConfigs[index],
        enabled: input.enabled,
        storeName: input.storeName,
        logo: input.logo,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail,
        requireAccountForCheckout: input.requireAccountForCheckout,
        guestTrackingEnabled: input.guestTrackingEnabled,
        allowedDeliveryMethods: [...input.allowedDeliveryMethods],
        allowedPaymentMethods: [...input.allowedPaymentMethods],
        defaultBranchId: input.defaultBranchId,
        updatedAt: this.now(),
      };
      return db.ecommerceConfigs[index];
    });
    this.emit("business-config.changed", { tenantId, action: "updated" });
    return updated;
  }
  async getHeroBanner(tenantId: string) {
    return this.read((db) => db.heroBanners.find((item) => item.tenantId === tenantId) ?? null);
  }
  async createHeroBanner(input: Parameters<BusinessConfigRepository["createHeroBanner"]>[0]) {
    const created = this.store.mutate((db) => {
      const item = { ...input, updatedAt: this.now() };
      db.heroBanners.push(item);
      return item;
    });
    this.emit("business-config.changed", { tenantId: input.tenantId, action: "created" });
    return created;
  }
  /** La subida a `/media` solo existe en modo api; el mock guarda imagenes como assets locales. */
  uploadEcommerceLogo(): Promise<never> {
    return Promise.reject(new Error(MOCK_UPLOAD_UNAVAILABLE));
  }

  uploadHeroBannerImage(): Promise<never> {
    return Promise.reject(new Error(MOCK_UPLOAD_UNAVAILABLE));
  }

  async updateHeroBanner(
    tenantId: string,
    input: Parameters<BusinessConfigRepository["updateHeroBanner"]>[1],
  ) {
    const updated = this.store.mutate((db) => {
      const index = db.heroBanners.findIndex((item) => item.tenantId === tenantId);
      if (index < 0) throw this.missing("HeroBannerConfig", tenantId);
      db.heroBanners[index] = {
        ...db.heroBanners[index],
        slides: input.slides,
        updatedAt: this.now(),
      };
      return db.heroBanners[index];
    });
    this.emit("business-config.changed", { tenantId, action: "updated" });
    return updated;
  }
}
