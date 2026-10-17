"use client";

import type { ReactNode } from "react";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

export function CommercialStorefrontGate({ children }: { children: ReactNode }) {
  const { config, loading, error } = usePublicTenant();

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-5 text-center text-[var(--color-text-muted)]">
        Cargando tienda...
      </main>
    );
  }

  if (error || !config) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-5 text-center">
        <section>
          <h1 className="text-3xl font-black text-[var(--color-text)]">Tienda no disponible</h1>
          <p className="mt-3 text-[var(--color-text-muted)]">
            No fue posible cargar esta tienda pública.
          </p>
        </section>
      </main>
    );
  }

  if (!config.storeEnabled) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-5 text-center">
        <section>
          <p className="text-sm font-bold uppercase tracking-wider text-[var(--color-primary-hover)]">
            {config.storeName}
          </p>
          <h1 className="mt-2 text-3xl font-black text-[var(--color-text)]">
            Tienda temporalmente deshabilitada
          </h1>
          <p className="mt-3 text-[var(--color-text-muted)]">
            La tienda en línea no está recibiendo pedidos en este momento.
          </p>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
