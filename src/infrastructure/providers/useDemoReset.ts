"use client";

import { useCallback } from "react";
import { clearCatalogImageAssets } from "@/infrastructure/media/IndexedDbCatalogImageAssetRepository";
import { useRepositories, useResetMockData } from "@/infrastructure/providers/RepositoryProvider";

/**
 * Reinicio de la demo publica: restaura los seeds, descarta la sesion mock, borra las imagenes
 * locales del catalogo y vuelve al login. Solo se invoca desde la UI de demo, previa confirmacion.
 */
export function useDemoReset() {
  const repositories = useRepositories();
  const resetMockData = useResetMockData();

  return useCallback(async () => {
    try {
      resetMockData();
      await repositories.auth.clearLocalSession();
      await clearCatalogImageAssets();
    } finally {
      // Recarga completa a proposito: descarta todo el estado en memoria de la sesion anterior.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/iniciar-sesion");
    }
  }, [repositories, resetMockData]);
}
