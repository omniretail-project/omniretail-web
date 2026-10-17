import type { ReactNode } from "react";
import type { EcommerceOrderDto } from "@/modules/administration/application/dto/EcommerceOrderDto";
import { formatAmount, customerName, deliveryMethodLabel, stringField } from "@/modules/administration/components/EcommerceOrdersTable";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatDate } from "@/shared/utils/formatDate";

export function EcommerceOrderDetailView({ order }: { order: EcommerceOrderDto }) {
  const deliveryAddress = order.deliveryAddress;
  const contact = order.notificationContact;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={order.status} />
        {order.trackingToken ? (
          <span className="text-sm text-[var(--color-text-muted)]">Seguimiento: {order.trackingToken}</span>
        ) : null}
      </div>

      <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
        <DetailItem label="Pedido" value={order.orderNumber} />
        <DetailItem label="Fecha" value={formatDate(order.createdAt)} />
        <DetailItem label="Cliente" value={customerName(order) ?? "Invitado"} />
        <DetailItem label="Método de entrega" value={deliveryMethodLabel(order.deliveryMethod)} />
        <DetailItem label="Correo" value={stringField(contact ?? {}, "email") ?? "—"} />
        <DetailItem label="Teléfono" value={stringField(contact ?? {}, "phone") ?? "—"} />
      </dl>

      {deliveryAddress ? (
        <section>
          <h3 className="text-sm font-bold text-[var(--color-title)]">Dirección de entrega</h3>
          <p className="mt-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-sm leading-6 text-[var(--color-text)]">
            {addressText(deliveryAddress)}
          </p>
        </section>
      ) : null}

      <section>
        <h3 className="text-sm font-bold text-[var(--color-title)]">Productos</h3>
        <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--color-app-background)] text-[var(--color-title)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Producto</th>
                <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr className="border-t border-[var(--color-border)]" key={item.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{item.sku}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatAmount(item.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <dl className="grid gap-2 rounded-lg border border-[var(--color-border)] p-4 text-sm sm:grid-cols-2">
        <DetailItem label="Subtotal" value={formatAmount(order.subtotal)} />
        <DetailItem label="Descuentos" value={formatAmount(order.discountTotal)} />
        <DetailItem label="Envío" value={formatAmount(order.shippingTotal)} />
        <DetailItem label="Total" value={<strong>{formatAmount(order.total)}</strong>} />
      </dl>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function addressText(address: Record<string, unknown>) {
  return [
    stringField(address, "recipientName") ?? stringField(address, "fullName"),
    stringField(address, "line1") ?? stringField(address, "addressLine1"),
    stringField(address, "line2") ?? stringField(address, "addressLine2"),
    stringField(address, "city"),
    stringField(address, "department") ?? stringField(address, "stateOrDepartment"),
    stringField(address, "phone") ?? stringField(address, "recipientPhone"),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
