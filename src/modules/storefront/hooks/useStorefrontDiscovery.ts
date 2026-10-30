"use client";

import { useStorefrontCatalogContext } from "@/modules/storefront/providers/StorefrontCatalogProvider";

/** Lee el catalogo compartido; la carga vive en StorefrontCatalogProvider (una sola por tenant). */
export function useStorefrontDiscovery() {
  return useStorefrontCatalogContext();
}
