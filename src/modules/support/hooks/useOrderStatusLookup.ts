"use client";

import { useCallback, useState } from "react";
import type { GuestOrderTrackingView } from "@/core/orders/resolveGuestOrderTracking";
import { resolveGuestOrderTracking } from "@/core/orders/resolveGuestOrderTracking";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

/**
 * Reproduce la MISMA consulta y la MISMA guarda que ya usa la pantalla
 * pública de seguimiento (/pedido/seguimiento/[trackingToken], módulo
 * storefront) -- vía core/orders/resolveGuestOrderTracking, un contrato
 * compartido, nunca importando el service interno de storefront
 * directamente (eso cruzaría a la capa interna de otro módulo). Nunca
 * expone más datos de los que esa pantalla pública ya expone.
 */
export function useOrderStatusLookup() {
  const repositories = useRepositories();
  const { tenantId } = usePublicTenant();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GuestOrderTrackingView | null>(null);
  const [error, setError] = useState<string | undefined>();

  const lookup = useCallback(
    async (trackingToken: string) => {
      setLoading(true);
      setError(undefined);
      setResult(null);
      try {
        if (!tenantId) {
          setError("No se pudo determinar la tienda pública.");
          return;
        }
        const view = await resolveGuestOrderTracking(
          repositories,
          tenantId,
          trackingToken.trim(),
        );
        if (!view) {
          setError("No se encontró el pedido con ese código de seguimiento.");
          return;
        }
        setResult(view);
      } finally {
        setLoading(false);
      }
    },
    [repositories, tenantId],
  );

  return { loading, result, error, lookup };
}
