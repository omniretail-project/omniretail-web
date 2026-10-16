"use client";

import { useCallback } from "react";
import { clearCatalogImageAssets } from "@/infrastructure/media/IndexedDbCatalogImageAssetRepository";
import { useRepositories, useResetMockData } from "@/infrastructure/providers/RepositoryProvider";

export interface DemoResetOptions {
  /** El borrado de imagenes espera a que se cierren otras pestanas de la demo. */
  onWaitingForOtherTabs?: () => void;
}

/**
 * Reinicio de la demo publica. Orden: 1) borrar las imagenes locales del catalogo y ESPERAR su
 * finalizacion real (si otra pestana lo bloquea se notifica la espera; el borrado no se cancela),
 * 2) restaurar los seeds, 3) descartar la sesion mock y 4) volver al login. Ante un error NO
 * redirige y lo relanza al caller, sin haber tocado datos ni sesion si fallo el borrado.
 * Solo se invoca desde la UI de demo, previa confirmacion.
 */
export function useDemoReset() {
  const repositories = useRepositories();
  const resetMockData = useResetMockData();

  return useCallback(
    async (options: DemoResetOptions = {}) => {
      await clearCatalogImageAssets({ onBlocked: options.onWaitingForOtherTabs });
      resetMockData();
      await repositories.auth.clearLocalSession();
      // Recarga completa a proposito: descarta todo el estado en memoria de la sesion anterior.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/iniciar-sesion");
    },
    [repositories, resetMockData],
  );
}
