"use client";

import Image from "next/image";
import Link from "next/link";
import { OrderStatus, PaymentStatus } from "@/core/enums";
import { StorefrontOrderProgress } from "@/modules/storefront/components/StorefrontOrderProgress";
import { downloadStorefrontReceiptPdf } from "@/modules/storefront/application/services/StorefrontReceiptPdfService";
import { useStorefrontCheckoutConfirmation } from "@/modules/storefront/providers/StorefrontCheckoutConfirmationProvider";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";
import { useStorefrontOrderConfirmation } from "@/modules/storefront/hooks/useStorefrontOrderConfirmation";

export function OrderConfirmationPage({ trackingToken: routeTrackingToken }: { trackingToken?: string }) {
  const routes = useStorefrontRoutes();
  const { result: providerResult } = useStorefrontCheckoutConfirmation();
  const { data: persistedResult, loading: loadingPersistedResult } =
    useStorefrontOrderConfirmation(routeTrackingToken);
  const { config } = usePublicTenant();
  // A result in memory is fast, but it is only valid for the token in this
  // route. A refresh/direct link reconstructs the same narrow view securely.
  const result = providerResult &&
    (!routeTrackingToken || providerResult.trackingToken === routeTrackingToken)
    ? providerResult
    : persistedResult;
  const orderNumber = result?.orderNumber;
  const trackingToken = result?.guestTrackingEnabled ? result.trackingToken : undefined;
  const emailSent = result?.confirmationEmailSent ?? false;
  const paymentApproved =
    result?.paymentStatus === PaymentStatus.approved &&
    result.orderStatus === OrderStatus.confirmed;
  const confirmedMessage = result?.hasInventoryReservations
    ? `Tu pedido ${orderNumber} fue confirmado y sus productos físicos quedaron reservados.`
    : `Tu pedido ${orderNumber} fue confirmado correctamente.`;

  if (routeTrackingToken && !result && loadingPersistedResult)
    return (
      <main className="mx-auto max-w-3xl px-5 py-14 text-[var(--color-text-muted)]">
        Cargando confirmaciÃ³n del pedido...
      </main>
    );

  if (!orderNumber)
    return (
      <main className="mx-auto max-w-3xl px-5 py-14">
        <section className="rounded-3xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
          <h1 className="text-3xl font-black text-[var(--color-text)]">
            No hay un pedido reciente
          </h1>
          <p className="mt-3 text-[var(--color-text-muted)]">
            Cuando completes una compra, verás la confirmación aquí.
          </p>
          <Link
            className="mt-6 inline-block rounded-xl bg-[var(--color-primary)] px-5 py-3 font-bold text-[var(--color-topbar)]"
          href={routes.catalog()}
          >
            Ver catálogo
          </Link>
        </section>
      </main>
    );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 print:max-w-none print:p-0 sm:px-5 sm:py-10">
      <section className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm print:hidden sm:p-9">
        <div className="rounded-2xl bg-emerald-50/60 px-4 py-6 text-center sm:px-6">
          <span className="inline-grid h-16 w-16 place-items-center rounded-full border-2 border-[var(--color-success)]/40 bg-[var(--color-success)]/15 text-3xl font-black text-[var(--color-success)]">
            ✓
          </span>
          <h1 className="mt-5 text-4xl font-black tracking-tight text-[var(--color-text)] sm:text-5xl">
            ¡Gracias por tu compra!
          </h1>
          <div className="mt-3 flex flex-wrap justify-center gap-3 text-sm">
            <span className="text-[var(--color-text-muted)]">Número de pedido:</span>
            <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 font-mono font-black text-[var(--color-title)]">
              {orderNumber}
            </span>
            <span className={`rounded-md border px-3 py-1 font-bold ${paymentApproved ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
              Estado: {paymentApproved ? "Confirmado" : "Pendiente"}
            </span>
          </div>
        </div>
        <div className="mt-8">
          <StorefrontOrderProgress status={result.orderStatus} />
        </div>
        <div className="mt-6 rounded-xl border border-[var(--color-border)] bg-slate-50 p-5">
          <p className="font-bold text-[var(--color-text)]">
            {paymentApproved
              ? confirmedMessage
              : `Tu pedido ${orderNumber} está pendiente de pago.`}
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Total pagado:{" "}
            <span className="font-black text-[var(--color-title)]">Q{result.total.toFixed(2)}</span>
          </p>
        </div>
        {emailSent ? (
          <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            El pedido fue confirmado correctamente.
          </p>
        ) : null}
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-slate-50 p-5">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
              <span className="text-[var(--color-title)]">⌖</span>
              <h2 className="font-black text-[var(--color-text)]">Dirección de entrega</h2>
            </div>
            <p className="mt-3 break-words font-bold text-[var(--color-text)] [overflow-wrap:anywhere]">
              {result.deliveryAddress.recipientName}
            </p>
            <p className="mt-2 break-words text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
              {result.deliveryAddress.line1}
              {result.deliveryAddress.line2 ? `, ${result.deliveryAddress.line2}` : ""}
            </p>
            <p className="mt-1 break-words text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
              {result.deliveryAddress.city}
              {result.deliveryAddress.department ? `, ${result.deliveryAddress.department}` : ""},
              Guatemala
            </p>
            <p className="mt-4 break-words text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
              ☎ {result.deliveryAddress.phone}
            </p>
          </section>
          <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-slate-50 p-5">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
              <span className="text-[var(--color-title)]">▣</span>
              <h2 className="font-black text-[var(--color-text)]">Detalle de pago</h2>
            </div>
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">Método de pago</p>
            <p className="break-words font-bold text-[var(--color-text)] [overflow-wrap:anywhere]">Tarjeta de crédito o débito</p>
            <p className="mt-4 break-words rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-3 py-2 text-sm font-semibold text-[var(--color-success)] [overflow-wrap:anywhere]">
              ✓ Información de pago confirmada.
            </p>
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">
              Total pagado:{" "}
              <span className="font-black text-[var(--color-title)]">
                Q{result.total.toFixed(2)}
              </span>
            </p>
          </section>
        </div>
        <section className="mt-6 overflow-hidden rounded-xl border border-[var(--color-border)]">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3 sm:px-5">
            <h2 className="font-black text-[var(--color-text)]">
              Productos en este pedido (
              {result.items.reduce((total, item) => total + item.quantity, 0)} unidades)
            </h2>
            <span className="font-mono text-sm font-bold text-[var(--color-title)]">
              Total: Q{result.total.toFixed(2)}
            </span>
          </div>
          <div className="divide-y divide-[var(--color-border)] bg-[var(--color-surface)] px-4 sm:px-5">
            {result.items.map((item) => (
              <article className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4 sm:flex-nowrap" key={item.sku}>
                <div className="flex min-w-0 items-center gap-3">
                  {item.imageUrl ? (
                    <Image
                      alt={item.imageAlt ?? item.name}
                      className="h-11 w-11 shrink-0 rounded-md border border-[var(--color-border)] bg-slate-50 object-contain object-center p-1"
                      height={44}
                      src={item.imageUrl}
                      width={44}
                    />
                  ) : (
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-[var(--color-border)] bg-slate-50 text-xs text-[var(--color-text-muted)]">
                      —
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="truncate font-bold text-[var(--color-text)]">{item.name}</h3>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      Cant: {item.quantity} • SKU: {item.sku} • P. Unit: Q
                      {item.unitPrice.toFixed(2)}
                    </p>
                  </div>
                </div>
                <p className="shrink-0 font-black text-[var(--color-title)]">
                  Q{item.subtotal.toFixed(2)}
                </p>
              </article>
            ))}
          </div>
        </section>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {trackingToken ? (
            <Link
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 font-bold text-[var(--color-title)] transition hover:bg-slate-50"
              href={routes.tracking(trackingToken)}
            >
              Ver seguimiento
            </Link>
          ) : null}
          <button
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 font-bold text-[var(--color-text)] transition hover:bg-slate-50"
            onClick={() =>
              void downloadStorefrontReceiptPdf({
                storeName: config?.storeName ?? "Tienda",
                result,
              })
            }
            type="button"
          >
            Descargar comprobante PDF
          </button>
          <Link
            className="rounded-xl bg-[var(--color-primary)] px-5 py-3 font-bold text-[var(--color-topbar)] transition hover:bg-[var(--color-primary-hover)]"
          href={routes.catalog()}
          >
            Seguir comprando
          </Link>
        </div>
      </section>
      <section className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:mt-0 print:block print:rounded-none print:border-0 print:shadow-none">
        <header className="grid gap-6 border-b-2 border-sky-500 bg-slate-50 px-6 py-7 sm:grid-cols-2 print:px-8 print:py-6">
          <div>
            <p className="text-sm font-black uppercase tracking-wide text-slate-800">
              {config?.storeName ?? "Tienda"}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-600">Comprobante de compra</p>
            <p className="text-xs leading-5 text-slate-600">Guatemala</p>
          </div>
          <div className="sm:text-right">
            <h1 className="text-2xl font-black text-slate-900">Comprobante de compra</h1>
            <p className="mt-2 text-sm font-bold text-slate-700">Pedido: {orderNumber}</p>
            <p className="text-xs text-slate-600">
              Fecha: {new Date().toLocaleDateString("es-GT")}
            </p>
            <p className="mt-1 inline-flex rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
              {paymentApproved ? "Pago confirmado" : "Pago pendiente"}
            </p>
          </div>
        </header>
        <div className="grid gap-5 px-6 py-5 text-sm sm:grid-cols-2 print:px-8">
          <div>
            <p className="font-black uppercase tracking-wide text-slate-700">Entrega a</p>
            <p className="mt-2 font-bold text-slate-900">{result.deliveryAddress.recipientName}</p>
            <p className="mt-1 text-slate-600">
              {result.deliveryAddress.line1}
              {result.deliveryAddress.line2 ? `, ${result.deliveryAddress.line2}` : ""}
            </p>
            <p className="text-slate-600">
              {result.deliveryAddress.city}
              {result.deliveryAddress.department ? `, ${result.deliveryAddress.department}` : ""}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="font-black uppercase tracking-wide text-slate-700">Método de pago</p>
            <p className="mt-2 font-bold text-slate-900">Tarjeta de crédito o débito</p>
            <p className="mt-1 text-slate-600">Información de pago confirmada</p>
          </div>
        </div>
        <div className="overflow-x-auto px-6 pb-5 print:px-8">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead className="bg-sky-600 text-xs font-black uppercase tracking-wide text-white">
              <tr>
                <th className="px-3 py-3">Descripción</th>
                <th className="px-3 py-3 text-center">Cantidad</th>
                <th className="px-3 py-3 text-right">Precio unit.</th>
                <th className="px-3 py-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr className="border-b border-slate-200" key={item.sku}>
                  <td className="px-3 py-3 font-semibold text-slate-800">{item.name}</td>
                  <td className="px-3 py-3 text-center text-slate-700">{item.quantity}</td>
                  <td className="px-3 py-3 text-right text-slate-700">
                    Q{item.unitPrice.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right font-bold text-slate-900">
                    Q{item.subtotal.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t-2 border-sky-500 px-6 py-5 print:px-8">
          <dl className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between gap-5 text-slate-700">
              <dt>Subtotal</dt>
              <dd>Q{result.total.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between gap-5 text-slate-700">
              <dt>Envío</dt>
              <dd>Q0.00</dd>
            </div>
            <div className="flex justify-between gap-5 border-t border-slate-300 pt-3 text-lg font-black text-slate-900">
              <dt>Total</dt>
              <dd>Q{result.total.toFixed(2)}</dd>
            </div>
          </dl>
        </div>
        <footer className="border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-500 print:px-8">
          Gracias por su compra. Este comprobante corresponde a su pedido.
        </footer>
      </section>
    </main>
  );
}
