"use client";

import Link from "next/link";
import { statusesConfig } from "@/config/statuses";
import { StorefrontOrderProgress } from "@/modules/storefront/components/StorefrontOrderProgress";
import { useStorefrontOrderTracking } from "@/modules/storefront/hooks/useStorefrontOrderTracking";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";

export function OrderTrackingPage({ trackingToken }: { trackingToken: string }) {
  const routes = useStorefrontRoutes();
  const { data, loading, error, reload } = useStorefrontOrderTracking(trackingToken);

  if (loading)
    return (
      <main className="mx-auto max-w-4xl px-5 py-12 text-[var(--color-text-muted)]">
        Cargando pedido...
      </main>
    );
  if (error || !data)
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <h1 className="text-3xl font-black">Seguimiento de pedido</h1>
        <p className="mt-4 text-[var(--color-text-muted)]">
          {error ?? "No se encontró el pedido."}
        </p>
        <div className="mt-5 flex gap-3">
          <button
            className="rounded-xl bg-[var(--color-primary)] px-4 py-3 font-bold text-[var(--color-topbar)]"
            onClick={reload}
            type="button"
          >
            Reintentar
          </button>
          <Link
            className="rounded-xl border border-[var(--color-border)] px-4 py-3 font-bold"
            href={routes.catalog()}
          >
            Ver catálogo
          </Link>
        </div>
      </main>
    );

  const status = statusesConfig[data.status];
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <Link className="text-sm font-bold text-[var(--color-title)]" href={routes.catalog()}>
        ← Seguir comprando
      </Link>
      <section className="mt-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <p className="text-sm text-[var(--color-text-muted)]">Pedido {data.orderNumber}</p>
          <h1 className="mt-2 text-3xl font-black text-[var(--color-text)]">
            Seguimiento de pedido
          </h1>
          <p className="mt-3 inline-block rounded-md border border-[var(--color-primary)] bg-[var(--color-primary)]/10 px-3 py-1 text-sm font-bold text-[var(--color-title)]">
            Estado actual: {status?.label ?? data.status}
          </p>
        </div>
        <div className="mt-7">
          <StorefrontOrderProgress status={data.status} />
        </div>
        <div className="mt-8">
          <div className="mt-8 space-y-3">
            {data.items.map((item, index) => (
              <article
                key={`${item.sku}-${index}`}
                className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary-hover)]">
                    {item.sku}
                  </p>
                  <h2 className="mt-1 font-black text-[var(--color-text)]">{item.name}</h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    Cantidad · {item.quantity}
                  </p>
                </div>
                <p className="font-black text-[var(--color-text)]">Q{item.subtotal.toFixed(2)}</p>
              </article>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-[var(--color-border)] pt-5">
            <span className="font-bold text-[var(--color-text)]">Total</span>
            <span className="text-3xl font-black text-[var(--color-title)]">
              Q{data.total.toFixed(2)}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
