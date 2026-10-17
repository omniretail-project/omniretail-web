import type { SaleReversalResultDto } from "@/modules/pos/application/dto/SaleReversalResultDto";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatCurrency } from "@/shared/utils/formatCurrency";

const paymentLabels: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};

export function SaleReversalResult({ result }: { result: SaleReversalResultDto }) {
  return (
    <section
      className="rounded-xl border border-[var(--color-success)]/40 bg-white p-4 shadow-sm sm:p-5"
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          status={result.operationType === "void" ? "Venta anulada" : "Devolución completada"}
          tone="success"
        />
        {result.idempotent ? <StatusBadge status="Resultado recuperado" tone="info" /> : null}
      </div>
      <h2 className="mt-3 text-xl font-bold text-[var(--color-title)]">
        {result.documentNumber ?? `Operación ${result.operationId}`} ·{" "}
        {formatCurrency(result.amount)}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        La operación fue procesada correctamente y el estado de la venta ya está actualizado.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {result.creditNote ? (
          <div className="rounded-lg bg-[var(--color-app-background)] p-3.5">
            <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
              Nota de crédito
            </p>
            <p className="mt-1 font-bold text-[var(--color-title)]">
              {result.creditNote.documentNumber}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              {formatCurrency(result.creditNote.amount)}
            </p>
          </div>
        ) : null}
        <div className="rounded-lg bg-[var(--color-app-background)] p-3.5">
          <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
            {result.refunds ? "Reembolso procesado" : "Efectos confirmados"}
          </p>
          {result.refunds?.map((refund) => (
            <p
              className="mt-1 text-sm text-[var(--color-title)]"
              key={`${refund.paymentId}-${refund.method}`}
            >
              {paymentLabels[refund.method] ?? refund.method}: {formatCurrency(refund.amount)}
            </p>
          ))}
          {!result.refunds ? (
            <p className="mt-1 text-sm text-[var(--color-title)]">
              El backend confirmó {result.inventoryMovementIds.length} movimiento(s) de inventario
              {result.cashMovementRecorded
                ? ` y ${result.cashMovementIds.length} movimiento(s) de caja.`
                : " y ningún movimiento de caja."}
            </p>
          ) : null}
          {result.cashMovementRecorded ? (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Se registró automáticamente la salida de efectivo
              {result.cashMovementAmount === undefined
                ? "."
                : ` por ${formatCurrency(result.cashMovementAmount)}.`}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
