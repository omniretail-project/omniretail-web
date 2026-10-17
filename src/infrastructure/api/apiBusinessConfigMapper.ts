import type {
  BusinessCapabilitiesConfig,
  CatalogImageSource,
  EcommerceConfig,
  HeroBannerConfig,
  HeroBannerSlide,
} from "@/core/entities";
import type { BusinessPreset, DeliveryMethod, PaymentMethod } from "@/core/enums";
import type { UpdateEcommerceConfigInput } from "@/core/repositories";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { toBackendMediaUrl, toSameOriginMediaUrl } from "@/infrastructure/api/mediaUrl";
import { assertOptionalApiUuid } from "@/infrastructure/api/uuid";

/** BusinessConfigResponse del backend (`/administration/business-config`). */
export interface ApiBusinessConfig {
  tenantId: string;
  preset: string;
  supportsInventory: boolean;
  supportsLots: boolean;
  supportsExpiration: boolean;
  supportsSerials: boolean;
  supportsMultipleLocations: boolean;
  supportsUnitsAndPackaging: boolean;
  supportsProductAttributes: boolean;
  supportsKits: boolean;
  supportsServices: boolean;
  allowedPosPaymentMethods: string[] | null;
  defaultProductTracking: ProductTrackingConfig;
}

/** SaveBusinessConfigRequest: la tienda sale del JWT, nunca del body. */
export type ApiSaveBusinessConfigRequest = Omit<
  ApiBusinessConfig,
  "tenantId" | "preset" | "allowedPosPaymentMethods"
> & {
  preset: BusinessPreset;
  allowedPosPaymentMethods?: PaymentMethod[];
};

/** EcommerceConfigResponse del backend (`/administration/ecommerce-config`). */
export interface ApiEcommerceConfig {
  tenantId: string;
  enabled: boolean;
  storeName: string;
  logoUrl: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  requireAccountForCheckout: boolean;
  guestTrackingEnabled: boolean;
  allowedDeliveryMethods: string[] | null;
  allowedPaymentMethods: string[] | null;
  defaultBranchId: string | null;
}

/** SaveEcommerceConfigRequest. Los metodos de entrega/pago los fija el backend (politica Web/App). */
export interface ApiSaveEcommerceConfigRequest {
  enabled: boolean;
  storeName: string;
  logoUrl?: string;
  contactPhone?: string;
  contactEmail?: string;
  requireAccountForCheckout: boolean;
  guestTrackingEnabled: boolean;
  allowedDeliveryMethods: DeliveryMethod[];
  allowedPaymentMethods: PaymentMethod[];
  defaultBranchId?: string;
}

/** HeroBannerSlideDto del backend. */
export interface ApiHeroBannerSlide {
  title: string;
  description: string;
  imageUrl: string | null;
}

/** HeroBannerConfigResponse / SaveHeroBannerConfigRequest (`/administration/hero-banner`). */
export interface ApiHeroBannerConfig {
  slides: ApiHeroBannerSlide[];
}

function toImage(url: string | null): CatalogImageSource | undefined {
  return url ? { kind: "url", src: toSameOriginMediaUrl(url) } : undefined;
}

/**
 * El backend solo guarda URLs. Una imagen `mockAsset` vive en el almacenamiento local del
 * navegador y no puede enviarse: se rechaza en vez de borrarla en silencio.
 */
function toImageUrl(image: CatalogImageSource | undefined, fieldName: string): string | undefined {
  if (!image) return undefined;
  if (image.kind === "url") return toBackendMediaUrl(image.src);
  throw new BackendRequestError(
    "El backend aún no admite subir imágenes; usa una imagen con URL pública.",
    400,
    "UNSUPPORTED_IMAGE_SOURCE",
    { [fieldName]: "Debe ser una URL pública." },
  );
}

export function toBusinessCapabilitiesConfig(
  config: ApiBusinessConfig,
): BusinessCapabilitiesConfig {
  return {
    tenantId: config.tenantId,
    preset: config.preset as BusinessPreset,
    supportsInventory: config.supportsInventory,
    supportsLots: config.supportsLots,
    supportsExpiration: config.supportsExpiration,
    supportsSerials: config.supportsSerials,
    supportsMultipleLocations: config.supportsMultipleLocations,
    supportsUnitsAndPackaging: config.supportsUnitsAndPackaging,
    supportsProductAttributes: config.supportsProductAttributes,
    supportsKits: config.supportsKits,
    supportsServices: config.supportsServices,
    allowedPosPaymentMethods: (config.allowedPosPaymentMethods ?? undefined) as
      PaymentMethod[] | undefined,
    defaultProductTracking: { ...config.defaultProductTracking },
  };
}

export function toBusinessConfigRequest(
  config: BusinessCapabilitiesConfig,
): ApiSaveBusinessConfigRequest {
  return {
    preset: config.preset,
    supportsInventory: config.supportsInventory,
    supportsLots: config.supportsLots,
    supportsExpiration: config.supportsExpiration,
    supportsSerials: config.supportsSerials,
    supportsMultipleLocations: config.supportsMultipleLocations,
    supportsUnitsAndPackaging: config.supportsUnitsAndPackaging,
    supportsProductAttributes: config.supportsProductAttributes,
    supportsKits: config.supportsKits,
    supportsServices: config.supportsServices,
    allowedPosPaymentMethods: config.allowedPosPaymentMethods,
    defaultProductTracking: { ...config.defaultProductTracking },
  };
}

/**
 * El backend no expone createdAt/updatedAt de la config e-commerce; se usa `fetchedAt` (momento de
 * la lectura) para cumplir el contrato.
 */
export function toEcommerceConfig(config: ApiEcommerceConfig, fetchedAt: string): EcommerceConfig {
  return {
    tenantId: config.tenantId,
    enabled: config.enabled,
    storeName: config.storeName,
    logo: toImage(config.logoUrl),
    contactPhone: config.contactPhone ?? undefined,
    contactEmail: config.contactEmail ?? undefined,
    requireAccountForCheckout: config.requireAccountForCheckout,
    guestTrackingEnabled: config.guestTrackingEnabled,
    allowedDeliveryMethods: (config.allowedDeliveryMethods ?? []) as DeliveryMethod[],
    allowedPaymentMethods: (config.allowedPaymentMethods ?? []) as PaymentMethod[],
    defaultBranchId: config.defaultBranchId ?? undefined,
    createdAt: fetchedAt,
    updatedAt: fetchedAt,
  };
}

export function toEcommerceConfigRequest(
  input: UpdateEcommerceConfigInput,
): ApiSaveEcommerceConfigRequest {
  assertOptionalApiUuid(input.defaultBranchId, "defaultBranchId");
  return {
    enabled: input.enabled,
    storeName: input.storeName,
    logoUrl: toImageUrl(input.logo, "logoUrl"),
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
    requireAccountForCheckout: input.requireAccountForCheckout,
    guestTrackingEnabled: input.guestTrackingEnabled,
    allowedDeliveryMethods: [...input.allowedDeliveryMethods],
    allowedPaymentMethods: [...input.allowedPaymentMethods],
    defaultBranchId: input.defaultBranchId,
  };
}

/** El backend no guarda tenantId ni updatedAt en la respuesta del carrusel. */
export function toHeroBannerConfig(
  config: ApiHeroBannerConfig,
  tenantId: string,
  fetchedAt: string,
): HeroBannerConfig {
  return {
    tenantId,
    slides: config.slides.map((slide): HeroBannerSlide => ({
      title: slide.title ?? "",
      description: slide.description ?? "",
      image: toImage(slide.imageUrl),
    })),
    updatedAt: fetchedAt,
  };
}

export function toHeroBannerRequest(slides: HeroBannerSlide[]): ApiHeroBannerConfig {
  return {
    slides: slides.map((slide) => ({
      title: slide.title,
      description: slide.description,
      imageUrl: toImageUrl(slide.image, "imageUrl") ?? null,
    })),
  };
}
