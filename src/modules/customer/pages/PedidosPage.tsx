"use client";

import { DeliveryMethod } from "@/core/enums";
import { useCustomerOrders } from "@/modules/customer/hooks/useCustomerOrders";
import { PackageIcon } from "@/shared/components/icons";
import { PageHeader } from "@/shared/components/PageHeader";
import { StatusBadge } from "@/shared/components/StatusBadge";
import Link from "next/link";

import { useOptionalStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";

const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  [DeliveryMethod.home_delivery]: "Entrega a domicilio",
  [DeliveryMethod.store_pickup]: "Recoger en tienda",
  [DeliveryMethod.immediate]: "Entrega inmediata",
};

/**
 * Solo lectura -- cualquier accion sobre un pedido (cancelar, ver detalle
 * completo, reordenar) es responsabilidad del modulo storefront, no de
 * este.
 */
export function PedidosPage() {
  const { orders, loading, error } = useCustomerOrders();
  const storefrontRoutes = useOptionalStorefrontRoutes();

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5">
      <PageHeader description="Historial de pedidos." title="Mis pedidos" />

      {error ? (
        <div
          className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-danger)]"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div
          aria-live="polite"
          className="flex min-h-40 items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm font-medium text-[var(--color-text-muted)] shadow-sm"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]"
          />
          Cargando pedidos...
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-structure)]">
            <PackageIcon className="h-5 w-5" />
          </span>
          <h2 className="mt-3 font-bold text-[var(--color-text)]">Aún no tiene pedidos</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Sus compras aparecerán aquí cuando complete un pedido.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const href = storefrontRoutes ? storefrontRoutes.accountOrder(order.id) : `/cuenta/pedidos/${order.id}`;
            return (
              <Link
                href={href}
                className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--color-structure)] hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
                key={order.id}
              >
                <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-structure)]"
                >
                  <PackageIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold text-[var(--color-text)]">
                    Pedido {order.orderNumber}
                  </p>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {new Date(order.createdAt).toLocaleDateString("es-GT", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}{" "}
                    · {order.itemCount} {order.itemCount === 1 ? "producto" : "productos"} ·{" "}
                    {DELIVERY_METHOD_LABELS[order.deliveryMethod]}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <StatusBadge status={order.status} />
                <span className="text-lg font-black text-[var(--color-title)]">
                  Q{order.total.toFixed(2)}
                </span>
              </div>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
