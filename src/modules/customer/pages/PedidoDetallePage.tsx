"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { toReceiptInput } from "@/modules/customer/application/services/orderReceiptAdapter";
import { useCustomerOrderDetail } from "@/modules/customer/hooks/useCustomerOrderDetail";
import { downloadStorefrontReceiptPdf } from "@/modules/storefront/application/services/StorefrontReceiptPdfService";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";
import { Button } from "@/shared/components/Button";
import { CompassIcon, CreditCardIcon, DownloadIcon, PackageIcon, TruckIcon } from "@/shared/components/icons";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { useToast } from "@/shared/components/Toast";

function SectionIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-structure)]"
    >
      {children}
    </span>
  );
}

export function PedidoDetallePage({ orderId }: { orderId: string }) {
  const routes = useStorefrontRoutes();
  const { order, loading, error } = useCustomerOrderDetail(orderId);
  const { config } = usePublicTenant();
  const { showToast } = useToast();
  const [downloading, setDownloading] = useState(false);

  if (loading) {
    return (
      <div className="min-w-0 p-4 text-sm text-[var(--color-text-muted)]">Cargando pedido...</div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-w-0 space-y-4">
        <p className="rounded-xl bg-red-50 p-4 text-sm text-[var(--color-danger)]">
          {error ?? "Pedido no encontrado."}
        </p>
    <Link className="font-bold text-[var(--color-title)] underline" href={routes.accountOrders()}>
          ← Volver a mis pedidos
        </Link>
      </div>
    );
  }

  async function handleDownloadReceipt() {
    if (!order) return;
    setDownloading(true);
    try {
      await downloadStorefrontReceiptPdf({
        storeName: config?.storeName ?? "Tienda",
        result: toReceiptInput(order),
      });
    } catch {
      showToast({
        title: "No se pudo generar el comprobante",
        description: "Inténtelo nuevamente.",
        tone: "danger",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
    <Link className="text-sm font-bold text-[var(--color-title)]" href={routes.accountOrders()}>
        ← Volver a mis pedidos
      </Link>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-border)] bg-slate-50 p-5 sm:p-7">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--color-primary-hover)]">Comprobante de pedido</p>
            <h1 className="mt-1 break-words text-2xl font-black text-[var(--color-text)]">
              Pedido {order.orderNumber}
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {new Date(order.createdAt).toLocaleDateString("es-GT", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusBadge status={order.status} />
            <p className="text-2xl font-black tracking-tight text-[var(--color-title)]">
              Q{order.total.toFixed(2)}
            </p>
          </div>
        </header>
        <div className="flex flex-wrap gap-2 border-b border-[var(--color-border)] p-5 sm:px-7">
          <Button href={routes.tracking(order.trackingToken)} variant="secondary">
            <CompassIcon className="h-4 w-4" />
            Ver seguimiento
          </Button>
          <Button disabled={downloading} onClick={() => void handleDownloadReceipt()} type="button" variant="secondary">
            <DownloadIcon className="h-4 w-4" />
            {downloading ? "Generando..." : "Descargar comprobante"}
          </Button>
        </div>

        <div className="grid gap-5 p-5 sm:p-7 md:grid-cols-2">
          <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-slate-50 p-4">
            <div className="flex items-center gap-2.5">
              <SectionIcon>
                <TruckIcon className="h-4 w-4" />
              </SectionIcon>
              <h2 className="font-black text-[var(--color-text)]">Entrega</h2>
            </div>
            {order.deliveryAddress ? (
              <div className="mt-3 break-words text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
                <p className="font-bold text-[var(--color-text)]">{order.deliveryAddress.recipientName}</p>
                <p>
                  {order.deliveryAddress.line1}
                  {order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ""}
                </p>
                <p>
                  {order.deliveryAddress.city}
                  {order.deliveryAddress.department ? `, ${order.deliveryAddress.department}` : ""}
                </p>
                {order.deliveryAddress.recipientPhone ? (
                  <p className="mt-2">Teléfono: {order.deliveryAddress.recipientPhone}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">Sin entrega a domicilio.</p>
            )}
          </section>

          <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-slate-50 p-4">
            <div className="flex items-center gap-2.5">
              <SectionIcon>
                <CreditCardIcon className="h-4 w-4" />
              </SectionIcon>
              <h2 className="font-black text-[var(--color-text)]">Método de pago</h2>
            </div>
            <p className="mt-3 break-words text-sm font-bold text-[var(--color-text)]">
              {order.payment?.method ?? "Pago registrado"}
            </p>
            {order.payment?.reference ? (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{order.payment.reference}</p>
            ) : null}
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">
              Estado: {order.payment?.status ?? "No disponible"}
            </p>
          </section>
        </div>

        <section className="border-t border-[var(--color-border)]">
          <div className="flex items-center gap-2.5 px-5 pt-5 sm:px-7">
            <SectionIcon>
              <PackageIcon className="h-4 w-4" />
            </SectionIcon>
            <h2 className="font-black text-[var(--color-text)]">Productos</h2>
          </div>
          <div className="divide-y divide-[var(--color-border)] px-5 sm:px-7">
            {order.items.map((item) => (
              <article
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-4"
                key={`${item.sku}-${item.name}`}
              >
                <div className="min-w-0">
                  <p className="break-words font-bold text-[var(--color-text)]">{item.name}</p>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {item.quantity} × Q{item.unitPrice.toFixed(2)} · {item.sku}
                  </p>
                </div>
                <p className="self-center whitespace-nowrap font-black text-[var(--color-title)]">
                  Q{item.subtotal.toFixed(2)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <div className="flex justify-end border-t border-[var(--color-border)] p-5 sm:p-7">
          <dl className="grid w-full max-w-sm gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt>Subtotal</dt>
              <dd>Q{order.subtotal.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Envío</dt>
              <dd>Q{order.shippingTotal.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-[var(--color-border)] pt-3 text-xl font-black">
              <dt>Total</dt>
              <dd>Q{order.total.toFixed(2)}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
