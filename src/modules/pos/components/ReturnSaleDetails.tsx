import type { ReturnSaleLookupDto } from "@/modules/pos/application/dto/ReturnSaleLookupDto";
import { isReturnBlockedNotice } from "@/modules/pos/application/services/GetReturnSaleLookupService";
import type { SaleReversalMode } from "@/modules/pos/hooks/usePosReturns";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import { formatDate } from "@/shared/utils/formatDate";

interface ReturnSaleDetailsProps {
  lookup: ReturnSaleLookupDto;
  canProcessReturn: boolean;
  canVoid: boolean;
  onBeginOperation: (mode: SaleReversalMode) => void;
}

const paymentLabels: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  mixed: "Mixto",
};

export function ReturnSaleDetails({
  lookup,
  canProcessReturn,
  canVoid,
  onBeginOperation,
}: ReturnSaleDetailsProps) {
  const returnBlockedNotice = isReturnBlockedNotice(lookup.allowedOperations.returnBlockedReason)
    ? formatOperationReason(lookup.allowedOperations.returnBlockedReason)
    : undefined;
  const columns: DataTableColumn<ReturnSaleLookupDto["items"][number]>[] = [
    {
      key: "product",
      header: "Producto",
      cell: (item) => (
        <div className="min-w-44">
          <p className="font-semibold text-[var(--color-title)]">{item.name}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{item.sku}</p>
          {item.blockedReason && !returnBlockedNotice ? (
            <p className="mt-1 text-xs text-[var(--color-warning)]">{item.blockedReason}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "sold",
      header: "Vendida",
      className: "whitespace-nowrap text-right tabular-nums",
      cell: (item) => item.soldQuantity,
    },
    {
      key: "returned",
      header: "Devuelta",
      className: "whitespace-nowrap text-right tabular-nums",
      cell: (item) => item.returnedQuantity,
    },
    {
      key: "returnable",
      header: "Retornable",
      className: "whitespace-nowrap text-right tabular-nums",
      cell: (item) => (
        <span className={item.canReturn ? "font-bold text-[var(--color-title)]" : undefined}>
          {item.returnableQuantity}
        </span>
      ),
    },
    {
      key: "subtotal",
      header: "Importe",
      className: "whitespace-nowrap text-right tabular-nums",
      cell: (item) => formatCurrency(item.subtotal),
    },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-[var(--color-title)]">Documento encontrado</h2>
              <StatusBadge
                status={saleStatusLabel(lookup.sale.status)}
                tone={saleStatusTone(lookup.sale.status)}
              />
              <StatusBadge
                status={lookup.isWithinCurrentShift ? "Dentro del turno" : "Fuera del turno"}
                tone={lookup.isWithinCurrentShift ? "success" : "neutral"}
              />
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Revisa las cantidades disponibles y las acciones permitidas para esta venta.
            </p>
          </div>
          <div className="rounded-lg bg-[var(--color-app-background)] px-4 py-3 lg:min-w-48 lg:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Total de la venta
            </p>
            <p className="mt-1 text-2xl font-bold text-[var(--color-title)]">
              {formatCurrency(lookup.sale.total)}
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryValue label="Documento" value={lookup.sale.documentNumber} />
          <SummaryValue label="Fecha" value={formatDate(lookup.sale.date)} />
          <SummaryValue label="Cliente" value={lookup.sale.customerDisplayName} />
          <SummaryValue label="Pago" value={formatPaymentSummary(lookup.paymentSummary)} />
        </dl>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-title)]">Productos de la venta</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Las cantidades retornables incluyen las devoluciones procesadas previamente.
          </p>
        </div>
        <DataTable
          columns={columns}
          data={lookup.items}
          headerClassName="bg-[var(--color-structure)] text-white [&_th]:text-white"
          rowKey={(item) => item.saleItemId}
        />
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="text-lg font-bold text-[var(--color-title)]">Reembolso disponible</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            El sistema distribuirá el reembolso definitivo sobre los pagos originales.
          </p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {lookup.payments.map((payment) => (
            <div
              className="min-w-0 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 shadow-sm"
              key={payment.paymentId}
            >
              <p className="font-semibold text-[var(--color-title)]">
                {paymentLabels[payment.method] ?? payment.method}
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {payment.refundableAmount === undefined ? "Pago original" : "Disponible"}:{" "}
                {formatCurrency(payment.refundableAmount ?? payment.amount)}
              </p>
              {(payment.refundedAmount ?? 0) > 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Reembolsado: {formatCurrency(payment.refundedAmount ?? 0)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-title)]">Operación</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Selecciona únicamente una operación permitida por el estado actual del documento.
          </p>
        </div>
        {returnBlockedNotice ? (
          <InlineAlert
            description={returnBlockedNotice}
            title="Devolución no disponible"
            tone="warning"
          />
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <OperationCard
            description="Devuelve cantidades específicas y conserva el resto de la venta."
            disabled={!canProcessReturn || !lookup.allowedOperations.partialReturn}
            label="Devolución parcial"
            reason={
              !canProcessReturn
                ? "No dispone de permisos para procesar devoluciones."
                : returnBlockedNotice
                  ? undefined
                  : formatOperationReason(lookup.allowedOperations.returnBlockedReason)
            }
            onClick={() => onBeginOperation("return")}
          />
          <OperationCard
            danger
            description="Revierte por completo una venta elegible dentro de su turno original."
            disabled={!canVoid || !lookup.allowedOperations.voidTotal}
            label="Anulación total"
            reason={
              !canVoid
                ? "No dispone de permisos para anular ventas."
                : formatOperationReason(lookup.allowedOperations.voidBlockedReason)
            }
            onClick={() => onBeginOperation("void")}
          />
        </div>
        {!lookup.allowedOperations.partialReturn && !lookup.allowedOperations.voidTotal ? (
          <InlineAlert
            description="Revisa la información mostrada en cada opción para conocer el motivo."
            title="La venta no tiene operaciones disponibles"
            tone="warning"
          />
        ) : null}
      </section>
    </div>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 break-words font-semibold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function OperationCard({
  label,
  description,
  reason,
  disabled,
  danger = false,
  onClick,
}: {
  label: string;
  description: string;
  reason?: string;
  disabled: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`flex flex-col rounded-lg border p-3.5 ${
        danger
          ? "border-[var(--color-danger)]/35 bg-[var(--color-danger)]/5"
          : "border-[var(--color-border)] bg-white"
      }`}
    >
      <h3 className="font-bold text-[var(--color-title)]">{label}</h3>
      <p className="mt-1 flex-1 text-sm text-[var(--color-text-muted)]">{description}</p>
      {reason ? <p className="mt-2.5 text-xs text-[var(--color-warning)]">{reason}</p> : null}
      <Button
        className="mt-3 w-full"
        disabled={disabled}
        type="button"
        variant={danger ? "danger" : "secondary"}
        onClick={onClick}
      >
        {disabled ? "No disponible" : `Iniciar ${label.toLowerCase()}`}
      </Button>
    </div>
  );
}

function formatPaymentSummary(summary: string) {
  return summary
    .split(" + ")
    .map((method) => paymentLabels[method] ?? method)
    .join(" + ");
}

function formatOperationReason(reason: string | undefined) {
  if (!reason) return reason;
  if (
    reason ===
    "No es posible procesar la devolución porque no se puede validar de forma segura el movimiento de inventario de esta venta."
  ) {
    return "Esta venta no cumple actualmente con las condiciones necesarias para procesar una devolución.";
  }
  if (reason === "La venta contiene inventario sin una huella historica reversible segura.") {
    return "Esta venta no cumple con las condiciones necesarias para realizar una anulación total.";
  }
  return reason;
}

function saleStatusLabel(status: ReturnSaleLookupDto["sale"]["status"]) {
  if (status === "completed") return "Completada";
  if (status === "partially_returned") return "Devolución parcial";
  if (status === "returned") return "Devuelta totalmente";
  return "Anulada";
}

function saleStatusTone(status: ReturnSaleLookupDto["sale"]["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "partially_returned") return "warning" as const;
  if (status === "returned") return "neutral" as const;
  return "danger" as const;
}
