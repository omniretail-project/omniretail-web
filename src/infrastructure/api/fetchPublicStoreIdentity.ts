import type { CatalogImageSource } from "@/core/entities";
import { toSameOriginMediaUrl } from "@/infrastructure/api/mediaUrl";

export interface PublicStoreIdentity {
  tenantId: string;
  enabled: boolean;
  storeName: string;
  logo?: CatalogImageSource;
}

interface BackendPublicStoreConfig {
  tenantId: string;
  enabled: boolean;
  storeName: string;
  logoUrl?: string | null;
}

/**
 * Identidad publica del negocio (`GET /public/{slug}/config`: nombre y logo). Es un endpoint sin
 * permisos, asi que cualquier empleado puede leerla sin `admin.ecommerce_config.manage`. El
 * llamador debe comprobar que `tenantId` coincide con el de la sesion antes de usar los datos.
 */
export async function fetchPublicStoreIdentity(tenantSlug: string): Promise<PublicStoreIdentity> {
  const response = await fetch(`/api/backend/public/${encodeURIComponent(tenantSlug)}/config`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("No se pudo cargar la identidad publica del negocio.");
  const data = (await response.json()) as BackendPublicStoreConfig;
  return {
    tenantId: data.tenantId,
    enabled: data.enabled,
    storeName: data.storeName,
    logo: data.logoUrl ? { kind: "url", src: toSameOriginMediaUrl(data.logoUrl) } : undefined,
  };
}
