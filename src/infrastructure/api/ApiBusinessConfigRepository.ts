import type {
  BusinessCapabilitiesConfig,
  EcommerceConfig,
  HeroBannerConfig,
} from "@/core/entities";
import type { BusinessConfigRepository, UpdateEcommerceConfigInput } from "@/core/repositories";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  type ApiBusinessConfig,
  type ApiEcommerceConfig,
  type ApiHeroBannerConfig,
  toBusinessCapabilitiesConfig,
  toBusinessConfigRequest,
  toEcommerceConfig,
  toEcommerceConfigRequest,
  toHeroBannerConfig,
  toHeroBannerRequest,
} from "@/infrastructure/api/apiBusinessConfigMapper";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";

const CAPABILITIES_PATH = "/administration/business-config";
const ECOMMERCE_PATH = "/administration/ecommerce-config";
const HERO_BANNER_PATH = "/administration/hero-banner";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** El backend ignora el nombre y valida el contenido real; solo se necesita uno coherente. */
function imageFilename(base: string, mimeType: string): string {
  return `${base}.${IMAGE_EXTENSIONS[mimeType] ?? "jpg"}`;
}

function imageForm(base: string, file: Blob): FormData {
  const form = new FormData();
  form.append("file", file, imageFilename(base, file.type));
  return form;
}

/**
 * Lectura que devuelve `null` cuando el recurso no existe para la tienda (404) o, si
 * `planMayLackIt`, cuando el plan no incluye la capacidad (403 CAPABILITY_REQUIRED): para el
 * contrato ambos casos significan "no hay configuracion".
 */
async function fetchOrNull<T>(path: string, planMayLackIt = false): Promise<T | null> {
  try {
    return await backendFetch<T>(path);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      if (error.status === 404) return null;
      if (planMayLackIt && error.status === 403 && error.code === "CAPABILITY_REQUIRED")
        return null;
    }
    throw error;
  }
}

/**
 * BusinessConfigRepository de modo api: consolida `/administration/business-config`,
 * `/ecommerce-config` y `/hero-banner`. El backend resuelve la tienda desde el JWT, asi que
 * `tenantId` solo valida que la respuesta sea de esa tienda; nunca se envia al backend.
 *
 * Los PUT del backend son upserts, por eso `create*` y `update*` usan el mismo endpoint.
 */
export class ApiBusinessConfigRepository implements BusinessConfigRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async getCapabilities(tenantId: string): Promise<BusinessCapabilitiesConfig | null> {
    const config = await fetchOrNull<ApiBusinessConfig>(CAPABILITIES_PATH);
    return config && config.tenantId === tenantId ? toBusinessCapabilitiesConfig(config) : null;
  }

  async createCapabilities(input: BusinessCapabilitiesConfig): Promise<BusinessCapabilitiesConfig> {
    return this.saveCapabilities(input, "created");
  }

  async updateCapabilities(
    tenantId: string,
    input: Partial<BusinessCapabilitiesConfig>,
  ): Promise<BusinessCapabilitiesConfig> {
    const current = await this.getCapabilities(tenantId);
    if (!current) throw new Error("Configuración del negocio no encontrada.");
    return this.saveCapabilities({ ...current, ...input, tenantId }, "updated");
  }

  async getEcommerceConfig(tenantId: string): Promise<EcommerceConfig | null> {
    const config = await fetchOrNull<ApiEcommerceConfig>(ECOMMERCE_PATH, true);
    return config && config.tenantId === tenantId
      ? toEcommerceConfig(config, new Date().toISOString())
      : null;
  }

  async createEcommerceConfig(
    input: Omit<EcommerceConfig, "createdAt" | "updatedAt">,
  ): Promise<EcommerceConfig> {
    return this.saveEcommerceConfig(input.tenantId, input, "created");
  }

  async updateEcommerceConfig(
    tenantId: string,
    input: UpdateEcommerceConfigInput,
  ): Promise<EcommerceConfig> {
    return this.saveEcommerceConfig(tenantId, input, "updated");
  }

  async uploadEcommerceLogo(tenantId: string, file: Blob): Promise<EcommerceConfig> {
    const saved = toEcommerceConfig(
      await backendFetch<ApiEcommerceConfig>(`${ECOMMERCE_PATH}/logo`, {
        method: "POST",
        body: imageForm("logo", file),
      }),
      new Date().toISOString(),
    );
    this.emitChanged(tenantId, "updated");
    return saved;
  }

  async uploadHeroBannerImage(
    tenantId: string,
    index: number,
    file: Blob,
  ): Promise<HeroBannerConfig> {
    if (!Number.isInteger(index) || index < 0) throw new Error("Diapositiva no válida.");
    const saved = toHeroBannerConfig(
      await backendFetch<ApiHeroBannerConfig>(`${HERO_BANNER_PATH}/slides/${index}/image`, {
        method: "POST",
        body: imageForm(`slide-${index + 1}`, file),
      }),
      tenantId,
      new Date().toISOString(),
    );
    this.emitChanged(tenantId, "updated");
    return saved;
  }

  async getHeroBanner(tenantId: string): Promise<HeroBannerConfig | null> {
    const config = await fetchOrNull<ApiHeroBannerConfig>(HERO_BANNER_PATH, true);
    return config ? toHeroBannerConfig(config, tenantId, new Date().toISOString()) : null;
  }

  async createHeroBanner(input: Omit<HeroBannerConfig, "updatedAt">): Promise<HeroBannerConfig> {
    return this.saveHeroBanner(input.tenantId, input, "created");
  }

  async updateHeroBanner(
    tenantId: string,
    input: Pick<HeroBannerConfig, "slides">,
  ): Promise<HeroBannerConfig> {
    return this.saveHeroBanner(tenantId, input, "updated");
  }

  private async saveCapabilities(
    input: BusinessCapabilitiesConfig,
    action: "created" | "updated",
  ): Promise<BusinessCapabilitiesConfig> {
    const saved = toBusinessCapabilitiesConfig(
      await backendFetch<ApiBusinessConfig>(CAPABILITIES_PATH, {
        method: "PUT",
        body: toBusinessConfigRequest(input),
      }),
    );
    this.emitChanged(saved.tenantId, action);
    return saved;
  }

  private async saveEcommerceConfig(
    tenantId: string,
    input: UpdateEcommerceConfigInput,
    action: "created" | "updated",
  ): Promise<EcommerceConfig> {
    const saved = toEcommerceConfig(
      await backendFetch<ApiEcommerceConfig>(ECOMMERCE_PATH, {
        method: "PUT",
        body: toEcommerceConfigRequest(input),
      }),
      new Date().toISOString(),
    );
    this.emitChanged(tenantId, action);
    return saved;
  }

  private async saveHeroBanner(
    tenantId: string,
    input: Pick<HeroBannerConfig, "slides">,
    action: "created" | "updated",
  ): Promise<HeroBannerConfig> {
    const saved = toHeroBannerConfig(
      await backendFetch<ApiHeroBannerConfig>(HERO_BANNER_PATH, {
        method: "PUT",
        body: toHeroBannerRequest(input.slides),
      }),
      tenantId,
      new Date().toISOString(),
    );
    this.emitChanged(tenantId, action);
    return saved;
  }

  private emitChanged(tenantId: string, action: "created" | "updated"): void {
    this.eventBus.emit("business-config.changed", { tenantId, action });
  }
}
