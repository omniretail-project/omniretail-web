import type { CashShiftSummaryDto } from "@/modules/pos/application/dto/CashShiftSummaryDto";
import type { PosCashShiftDto } from "@/modules/pos/application/dto/PosCashShiftDto";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import { formatDate } from "@/shared/utils/formatDate";

interface CashShiftSummaryProps {
  branchName: string | null;
  cashierName: string | null;
  cashShift: PosCashShiftDto;
  summary: CashShiftSummaryDto;
}

export function CashShiftSummary({
  branchName,
  cashierName,
  cashShift,
  summary,
}: CashShiftSummaryProps) {
  return (
    <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-title)]">Turno activo</h2>
          <p className="mt-0.5 text-sm font-medium text-[var(--color-text)]">
            {branchName ?? "Sucursal activa"}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Caja {cashShift.registerCode} · {cashierName ?? "Cajero"} · Apertura{" "}
            {formatDate(summary.openedAt)}
          </p>
        </div>
        <StatusBadge status="Caja abierta" tone="success" />
      </div>

      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryValue label="Fondo inicial" value={summary.openingAmount} />
        <SummaryValue label="Ventas en efectivo" value={summary.cashSalesAmount} />
        <SummaryValue label="Ingresos manuales" value={summary.manualCashIn} />
        <SummaryValue label="Egresos manuales" value={summary.manualCashOut} />
      </dl>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-[var(--color-structure)]/35 bg-[var(--color-app-background)] px-3 py-3 sm:px-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Efectivo esperado
          </p>
          <p className="mt-1 text-2xl font-bold leading-none text-[var(--color-title)]">
            {formatCurrency(summary.expectedCash)}
          </p>
        </div>
        <p className="text-right text-xs text-[var(--color-text-muted)]">
          {summary.movementCount} movimientos · {summary.saleCount} ventas
        </p>
      </div>
    </section>
  );
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 font-bold text-[var(--color-title)]">{formatCurrency(value)}</dd>
    </div>
  );
}
