import type { StorefrontOrderTrackingDto } from "@/modules/storefront/application/dto/StorefrontOrderTrackingDto";

export class ApiStorefrontOrderTrackingService {
  async execute({ tenantSlug, trackingToken }: { tenantSlug: string; trackingToken: string }): Promise<StorefrontOrderTrackingDto | null> {
    const response = await fetch(
      `/api/public/${encodeURIComponent(tenantSlug)}/tracking/${encodeURIComponent(trackingToken)}`,
      { cache: "no-store" },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("No se pudo cargar el pedido.");
    return (await response.json()) as StorefrontOrderTrackingDto;
  }
}
