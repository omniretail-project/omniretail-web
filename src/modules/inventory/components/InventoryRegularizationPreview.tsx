"use client";

import type {
  LegacyBalanceRegularizationPreview,
  LocationRegularizationResult,
} from "@/core/repositories";
import { describeRegularizationBlocker } from "@/modules/inventory/application/services/inventoryRegularizationMessages";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { cn } from "@/shared/utils/cn";
import { formatNumber } from "@/shared/utils/formatNumber";

const NAVY_HEADER = "bg-[var(--color-structure)] text-white [&_th]:text-white";

type StatTone = "info" | "warning" | "neutral" | "success";

/** Mismo patron visual que las tarjetas KPI del historial de movimientos. */
function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: StatTone;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-l-4 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-sm",
        tone === "info" && "border-l-blue-400",
        tone === "warning" && "border-l-indigo-400",
        tone === "success" && "border-l-emerald-400",
        tone === "neutral" && "border-l-slate-300",
      )}
    >
      <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</p>
      <strong className="mt-1 block break-words text-2xl font-bold leading-none tracking-tight text-[var(--color-title)]">
        {value}
      </strong>
      {hint ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p> : null}
    </div>
  );
}

/** El codigo tecnico queda como detalle secundario y colapsado, nunca como texto principal. */
function DiagnosticDetail({ code, label = "Código" }: { code?: string; label?: string }) {
  if (!code) return null;
  return (
    <details className="mt-1 text-xs text-[var(--color-text-muted)]">
      <summary className="cursor-pointer select-none font-semibold">Detalle técnico</summary>
      <p className="mt-1 break-all">
        {label}: {code}
      </p>
    </details>
  );
}

interface QuantityRow {
  key: string;
  concept: string;
  source: number;
  destination: number;
  resulting: number;
}

export function InventoryRegularizationPreview({
  preview,
  locationLabel,
}: {
  preview: LegacyBalanceRegularizationPreview;
  /** "ES-01 · Estante 1"; si no se conoce el codigo, se usa el nombre de la vista previa. */
  locationLabel?: string;
}) {
  const destinationName = locationLabel ?? preview.locationName;
  const rows: QuantityRow[] = [
    {
      key: "quantity",
      concept: "Existencia",
      source: preview.sourceQuantity,
      destination: preview.destinationQuantity,
      resulting: preview.resultingQuantity,
    },
    {
      key: "reserved",
      concept: "Reservado",
      source: preview.sourceReservedQuantity,
      destination: preview.destinationReservedQuantity,
      resulting: preview.resultingReservedQuantity,
    },
  ];
  const columns: DataTableColumn<QuantityRow>[] = [
    { key: "concept", header: "Concepto", cell: (row) => row.concept },
    {
      key: "source",
      header: "Sin ubicación (origen)",
      className: "text-right tabular-nums",
      cell: (row) => formatNumber(row.source),
    },
    {
      key: "destination",
      header: "En el destino hoy",
      className: "text-right tabular-nums",
      cell: (row) => formatNumber(row.destination),
    },
    {
      key: "resulting",
      header: "Quedará en el destino",
      className: "text-right font-semibold tabular-nums",
      cell: (row) => formatNumber(row.resulting),
    },
  ];
  const details: Array<{ label: string; value: number }> = [
    { label: "Reservas activas", value: preview.activeReservations },
    { label: "Reservas sin ubicación asignada", value: preview.emptyAllocationReservations },
    { label: "Saldos por lote", value: preview.lotBalances },
    { label: "Series", value: preview.serials },
  ];

  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold text-[var(--color-title)]">
          {preview.productName}{" "}
          <span className="font-normal text-[var(--color-text-muted)]">· {preview.sku}</span>
        </p>
        <p className="break-words text-sm text-[var(--color-text-muted)]">
          Se consolidará en: <span className="font-semibold text-[var(--color-title)]">{destinationName}</span>
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          hint="Existencias heredadas por mover"
          label="Sin ubicación"
          tone="info"
          value={formatNumber(preview.sourceQuantity)}
        />
        <StatCard
          hint="Unidades reservadas que se mueven"
          label="Reservado"
          tone="warning"
          value={formatNumber(preview.sourceReservedQuantity)}
        />
        <StatCard
          hint="Existencia actual de la ubicación"
          label="En el destino hoy"
          tone="neutral"
          value={formatNumber(preview.destinationQuantity)}
        />
        <StatCard
          hint="Total tras regularizar"
          label="Quedará en el destino"
          tone="success"
          value={formatNumber(preview.resultingQuantity)}
        />
      </section>

      <DataTable
        columns={columns}
        data={rows}
        headerClassName={NAVY_HEADER}
        rowKey={(row) => row.key}
      />

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {details.map((detail) => (
          <div
            className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2"
            key={detail.label}
          >
            <dt className="text-xs text-[var(--color-text-muted)]">{detail.label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-[var(--color-title)]">
              {formatNumber(detail.value)}
            </dd>
          </div>
        ))}
      </dl>

      {preview.blockers.length > 0 ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm font-semibold text-[var(--color-danger)]">
            {preview.blockers.length === 1
              ? "Hay una condición que impide regularizar"
              : `Hay ${preview.blockers.length} condiciones que impiden regularizar`}
          </p>
          {preview.blockers.map((blocker, index) => {
            const message = describeRegularizationBlocker(blocker);
            return (
              <InlineAlert
                description={message.hint}
                key={`${blocker.code}-${index}`}
                title={message.title}
              >
                <DiagnosticDetail code={message.diagnosticCode} />
              </InlineAlert>
            );
          })}
        </div>
      ) : preview.eligible ? (
        <InlineAlert
          description="No hay bloqueos. Revisa las cantidades e ingresa un motivo para confirmar."
          title="La regularización puede realizarse."
          tone="success"
        />
      ) : (
        <InlineAlert
          description="Actualiza la vista previa e inténtalo de nuevo."
          title="La regularización no está disponible por ahora."
          tone="warning"
        />
      )}
    </div>
  );
}

interface ResultRow {
  key: string;
  label: string;
  value: string;
}

export function InventoryRegularizationResult({
  result,
  productName,
  locationName,
}: {
  result: LocationRegularizationResult;
  productName: string;
  locationName: string;
}) {
  const rows: ResultRow[] = [
    {
      key: "assignment",
      label: "Ubicación asignada en esta operación",
      value: result.assignmentApplied ? "Sí" : "No",
    },
    { key: "moved", label: "Cantidad movida", value: formatNumber(result.movedQuantity) },
    {
      key: "movedReserved",
      label: "Reservado movido",
      value: formatNumber(result.movedReservedQuantity),
    },
    {
      key: "before",
      label: "En el destino antes",
      value: formatNumber(result.destinationQuantityBefore),
    },
    {
      key: "after",
      label: "En el destino ahora",
      value: formatNumber(result.destinationQuantityAfter),
    },
    {
      key: "reservedAfter",
      label: "Reservado en el destino ahora",
      value: formatNumber(result.destinationReservedQuantityAfter),
    },
    {
      key: "reservations",
      label: "Reservas actualizadas",
      value: formatNumber(result.reservationsReassigned),
    },
    { key: "lots", label: "Lotes consolidados", value: formatNumber(result.lotBalancesMerged) },
    { key: "serials", label: "Series reubicadas", value: formatNumber(result.serialsRelocated) },
    {
      key: "createdAt",
      label: "Registrada",
      value: new Date(result.createdAt).toLocaleString("es-GT"),
    },
  ];
  const columns: DataTableColumn<ResultRow>[] = [
    { key: "label", header: "Dato", cell: (row) => row.label },
    {
      key: "value",
      header: "Valor registrado",
      className: "text-right tabular-nums",
      cell: (row) => row.value,
    },
  ];

  return (
    <div className="min-w-0 space-y-4">
      <InlineAlert
        description={
          result.idempotent
            ? "Esta solicitud ya se había aplicado. Se muestra el resultado registrado; no se movió inventario otra vez."
            : result.assignmentApplied
              ? `${productName} quedó con ${locationName} como ubicación de inventario y su saldo se consolidó allí. Las existencias totales no cambiaron y el movimiento quedó en el historial.`
              : `${productName} ahora opera en ${locationName}. Las existencias totales no cambiaron y el movimiento quedó en el historial.`
        }
        title={
          result.idempotent
            ? "La regularización ya estaba registrada"
            : "Regularización realizada"
        }
        tone={result.idempotent ? "info" : "success"}
      />
      <section className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Cantidad movida"
          tone="success"
          value={formatNumber(result.movedQuantity)}
        />
        <StatCard
          label="Existencia en el destino ahora"
          tone="info"
          value={formatNumber(result.destinationQuantityAfter)}
        />
      </section>
      <DataTable
        columns={columns}
        data={rows}
        headerClassName={NAVY_HEADER}
        rowKey={(row) => row.key}
      />
    </div>
  );
}

export { DiagnosticDetail };
