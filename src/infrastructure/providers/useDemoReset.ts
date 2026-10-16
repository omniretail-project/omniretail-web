"use client";

import { useCallback } from "react";
import { clearCatalogImageAssets } from "@/infrastructure/media/IndexedDbCatalogImageAssetRepository";
import { useRepositories, useResetMockData } from "@/infrastructure/providers/RepositoryProvider";

/**
 * Reinicio de la demo publica: borra las imagenes locales del catalogo PRIMERO (si la base esta
 * bloqueada por otra pestana se aborta sin tocar datos), restaura los seeds, descarta la sesion
 * mock y solo entonces vuelve al login. Ante un fallo NO redirige y relanza el error al caller.
 * Solo se invoca desde la UI de demo, previa confirmacion.
 */
export function useDemoReset() {
  const repositories = useRepositories();
  const resetMockData = useResetMockData();

  return useCallback(async () => {
    await clearCatalogImageAssets();
    resetMockData();
    await repositories.auth.clearLocalSession();
    // Recarga completa a proposito: descarta todo el estado en memoria de la sesion anterior.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/iniciar-sesion");
  }, [repositories, resetMockData]);
}
