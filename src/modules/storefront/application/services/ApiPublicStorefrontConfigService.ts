import { toSameOriginMediaUrl } from "@/infrastructure/api/mediaUrl";
import type { PublicStorefrontConfigDto } from "@/modules/storefront/application/dto/PublicStorefrontConfigDto";

interface BackendBannerSlide {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
}

interface BackendPublicStorefrontBranch {
  id: string;
  code?: string | null;
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface BackendPublicStorefrontConfig {
  tenantId: string;
  enabled: boolean;
  storeName: string;
  logoUrl?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  requireAccountForCheckout: boolean;
  guestTrackingEnabled: boolean;
  slides?: BackendBannerSlide[];
  branches?: BackendPublicStorefrontBranch[];
}

export class ApiPublicStorefrontConfigService {
  async execute(tenantSlug: string): Promise<{ tenantId: string; config: PublicStorefrontConfigDto }> {
    const response = await fetch(`/api/backend/public/${encodeURIComponent(tenantSlug)}/config`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("No se pudo cargar la configuración de la tienda.");
    const data = (await response.json()) as BackendPublicStorefrontConfig;
    return {
      tenantId: data.tenantId,
      config: {
        storeName: data.storeName,
        storeEnabled: data.enabled,
        accountRequired: data.requireAccountForCheckout,
        guestTrackingEnabled: data.guestTrackingEnabled,
        contactPhone: data.contactPhone ?? undefined,
        contactEmail: data.contactEmail ?? undefined,
        logoImageSource: data.logoUrl
          ? { kind: "url", src: toSameOriginMediaUrl(data.logoUrl) }
          : undefined,
        branches: (data.branches ?? []).map((branch) => ({
          id: branch.id,
          code: branch.code ?? undefined,
          name: branch.name,
          address: branch.address ?? undefined,
          phone: branch.phone ?? undefined,
          email: branch.email ?? undefined,
        })),
        heroBanner: {
          slides: (data.slides ?? []).map((slide) => ({
            title: slide.title ?? "",
            description: slide.description ?? "",
            imageSource: slide.imageUrl
              ? { kind: "url", src: toSameOriginMediaUrl(slide.imageUrl) }
              : undefined,
          })),
        },
      },
    };
  }
}
