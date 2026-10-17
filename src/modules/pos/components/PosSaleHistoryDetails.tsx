import type { ReactNode } from "react";
import type { PosSaleHistoryItemDto } from "@/modules/pos/application/dto/PosSaleHistoryDto";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatCurrency } from "@/shared/utils/formatCurrency";

interface PosSaleHistoryDetailsProps {
  sale: PosSaleHistoryItemDto | null;
  loading?: boolean;
  error?: string | null;
}

export function PosSaleHistoryDetails({
  sale,
  loading = false,
  error = null,
}: Readonly<PosSaleHistoryDetailsProps>) {
  if (!sale) {
    return (
      <aside className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] p-6 text-center text-sm text-[var(--color-text-muted)]">
        {loading
          ? "Cargando detalle de la venta..."
          : (error ?? "Selecciona una venta para consultar su detalle.")}
      </aside>
    );
  }

  return (
    <aside className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm xl:sticky xl:top-3">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Documento</p>
          <p className="break-words text-lg font-bold text-[var(--color-title)]">
            {sale.documentNumber}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {formatDateTime(sale.createdAt)}
          </p>
        </div>
        <div className="shrink-0 [&>span]:px-2 [&>span]:py-1 [&>span]:text-[11px]">
          <StatusBadge status={sale.saleStatusLabel} tone={sale.saleStatusTone} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 py-3">
        <DetailItem label="Tipo" value={sale.documentType === "invoice" ? "Factura" : "Ticket"} />
        <DetailItem label="NIT" value={sale.taxId ?? "—"} />
        <DetailItem label="Cliente" value={sale.customerDisplayName} />
        <DetailItem label="Entrega" value={sale.deliveryMethodLabel} />
        <DetailItem
          label="Pago"
          value={
            <div>
              <p>{sale.paymentSummary}</p>
              {sale.payments.length > 1 ? (
                <ul className="mt-1 space-y-0.5 text-xs font-normal text-[var(--color-text-muted)]">
                  {sale.payments.map((payment) => (
                    <li key={payment.paymentId}>
                      {payment.methodLabel}: {formatCurrency(payment.amount, payment.currency)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          }
        />
        <DetailItem
          label="Total"
          value={<span className="text-sm text-[var(--color-title)]">{formatCurrency(sale.total)}</span>}
        />
        {sale.sourceOrderId ? (
          <DetailItem fullWidth label="Estado operativo" value={sale.operationalStatusLabel} />
        ) : null}
      </dl>

      <p className="mt-1 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs leading-relaxed text-[var(--color-text)]">
        Para anular o devolver esta venta, utiliza el número{" "}
        <span className="font-semibold text-[var(--color-title)]">{sale.documentNumber}</span> en el
        módulo de Anulaciones.
      </p>
    </aside>
  );
}

function DetailItem({
  fullWidth = false,
  label,
  value,
}: {
  fullWidth?: boolean;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] px-2.5 py-2 ${fullWidth ? "col-span-2" : ""}`}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words text-xs font-semibold text-[var(--color-title)]">
        {value}
      </dd>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
