"use client";

import { useEffect, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";

/**
 * Slug público del tenant de la sesión actual, para armar el enlace de su tienda en línea
 * (`/tienda/{slug}`). Si no se puede resolver devuelve `null` y la pantalla simplemente no muestra
 * el enlace: no es un error que deba bloquear la configuración.
 */
export function useStorefrontSlug(): string | null {
  const repositories = useRepositories();
  const { user, loading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (loading || !tenantId) return;

    repositories.tenants
      .getById(tenantId)
      .then((tenant) => {
        if (active) setSlug(tenant?.slug?.trim() || null);
      })
      .catch(() => {
        if (active) setSlug(null);
      });

    return () => {
      active = false;
    };
  }, [loading, repositories, tenantId]);

  return tenantId ? slug : null;
}
