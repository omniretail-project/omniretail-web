"use client";

import { useEffect, useMemo } from "react";
import type {
  PickingFefoPreviewAllocationDto,
  PickingFefoPreviewDto,
  PickingFefoPreviewQueryDto,
} from "@/modules/logistics/application/dto/PickingReadModelDto";
import {
  type PickingFefoPreviewState,
  usePickingFefoPreview,
} from "@/modules/logistics/hooks/usePickingFefoPreview";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";

interface PickingFefoPreviewProps {
  query: PickingFefoPreviewQueryDto | null;
  onStateChange?: (state: PickingFefoPreviewState) => void;
  purpose?: "completion" | "entered";
}

export function PickingFefoPreview({ query, onStateChange, purpose = "entered" }: PickingFefoPreviewProps) {
  const state = usePickingFefoPreview(query);
  useEffect(() => {
    onStateChange?.({ status: state.status, data: state.data, error: state.error });
  }, [onStateChange, state.data, state.error, state.status]);
  return <PickingFefoPreviewContent purpose={purpose} state={state} onRetry={() => void state.reload()} />;
}

export function PickingFefoPreviewContent({
  state,
  onRetry,
  purpose = "entered",
}: {
  state: PickingFefoPreviewState;
  onRetry?: () => void;
  purpose?: "completion" | "entered";
}) {
  const completionRecommendation = purpose === "completion";
  const sortedIncremental = useMemo(
    () => sortFefoAllocations(state.data?.incrementalAllocations ?? []),
    [state.data?.incrementalAllocations],
  );
  const sortedExisting = useMemo(
    () => sortFefoAllocations(state.data?.existingSelections ?? []),
    [state.data?.existingSelections],
  );
  const sortedResulting = useMemo(
    () => sortFefoAllocations(state.data?.resultingSelections ?? []),
    [state.data?.resultingSelections],
  );
  if (state.status === "idle") {
    return (
      <InlineAlert
        description={completionRecommendation
          ? "Selecciona una ubicación para consultar los lotes que debes recoger."
          : "Ingresa una cantidad mayor a la que ya recogiste."}
        title={completionRecommendation ? "Selecciona una ubicación" : "Indica la cantidad a recoger"}
        tone="info"
      />
    );
  }
  if (state.status === "loading") {
    return <InlineAlert description="Consultando lotes y cantidades disponibles..." title={completionRecommendation ? "Cargando lotes recomendados" : "Calculando lotes para esta cantidad"} tone="info" />;
  }
  if (state.status === "error") {
    return (
      <InlineAlert
        description={state.error === "No se pudo calcular la vista previa FEFO."
          ? "No se pudieron consultar los lotes disponibles."
          : state.error ?? "No se pudieron consultar los lotes disponibles."}
        title={completionRecommendation ? "No se pudieron cargar los lotes recomendados" : "No se pudieron calcular los lotes"}
        tone="warning"
      >
        {onRetry ? <Button onClick={onRetry} type="button" variant="secondary">Reintentar</Button> : null}
      </InlineAlert>
    );
  }
  if (!state.data || sortedIncremental.length === 0) {
    return <InlineAlert description="No hay unidades pendientes para distribuir entre lotes." title="Sin unidades pendientes" tone="info" />;
  }
  const data = state.data;
  return (
    <section
      aria-label={completionRecommendation ? "Lotes recomendados para recoger" : "Lotes para la cantidad indicada"}
      className="rounded-lg border border-[var(--color-primary)]/25 bg-white p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h5 className="text-sm font-bold text-[var(--color-title)]">
            {completionRecommendation ? "Lotes recomendados para recoger" : "Lotes para la cantidad indicada"}
          </h5>
          <p className="text-xs text-[var(--color-text-muted)]">
            Esta recomendación puede cambiar según la disponibilidad al momento de registrar la recolección.
          </p>
        </div>
        <span className="rounded-full bg-[var(--color-app-background)] px-2.5 py-1 text-xs font-bold text-[var(--color-title)]">
          {completionRecommendation ? "Por recoger" : "Cantidad adicional"}: {formatQuantity(data.incrementalQuantity)}
        </span>
      </div>
      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
        <div><dt className="text-[var(--color-text-muted)]">Cantidad recogida</dt><dd className="font-bold">{formatQuantity(data.currentPickedQuantity)}</dd></div>
        <div><dt className="text-[var(--color-text-muted)]">{completionRecommendation ? "Cantidad pendiente" : "Cantidad adicional"}</dt><dd className="font-bold">{formatQuantity(data.incrementalQuantity)}</dd></div>
        <div><dt className="text-[var(--color-text-muted)]">{completionRecommendation ? "Cantidad requerida" : "Cantidad después de guardar"}</dt><dd className="font-bold">{formatQuantity(data.targetPickedQuantity)}</dd></div>
      </dl>
      {!completionRecommendation && sortedExisting.length > 0 ? (
        <FefoAllocationGroup allocations={sortedExisting} label="Lotes ya recogidos" />
      ) : null}
      <FefoAllocationGroup
        allocations={sortedIncremental}
        label={completionRecommendation ? "Lotes que debes recoger" : "Lotes para esta recolección"}
        quantityPrefix="Recoger "
      />
      {!completionRecommendation ? (
        <FefoAllocationGroup allocations={sortedResulting} label="Resultado estimado después de guardar" />
      ) : null}
      <p className="mt-2 text-right text-sm font-bold text-[var(--color-title)]">
        {completionRecommendation ? "Total pendiente por recoger" : "Total que agregarás"}: {formatQuantity(data.incrementalQuantity)} unidades
      </p>
    </section>
  );
}

function FefoAllocationGroup({
  allocations,
  label,
  quantityPrefix = "",
}: {
  allocations: PickingFefoPreviewAllocationDto[];
  label: string;
  quantityPrefix?: string;
}) {
  if (allocations.length === 0) return null;
  return (
    <div aria-label={label} className="mt-3 space-y-1.5" role="group">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      {allocations.map((allocation, index) => (
        <div
          className="grid gap-1 rounded-md bg-slate-50 px-2.5 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
          key={`${allocation.expirationDate}-${allocation.lotNumber}-${allocation.locationCode}-${allocation.lotId}-${index}`}
        >
          <span className="font-semibold text-[var(--color-title)]">Lote {allocation.lotNumber}</span>
          <span className="text-[var(--color-text-muted)]">
            Vence {formatLocalDate(allocation.expirationDate)} · {allocation.locationCode} · {allocation.locationName}
          </span>
          <span className="font-bold text-[var(--color-title)]">{quantityPrefix}{formatQuantity(allocation.quantity)}</span>
        </div>
      ))}
    </div>
  );
}

export function sortFefoAllocations(
  allocations: PickingFefoPreviewAllocationDto[],
): PickingFefoPreviewAllocationDto[] {
  return [...allocations].sort((left, right) =>
    left.expirationDate.localeCompare(right.expirationDate) ||
    left.lotNumber.localeCompare(right.lotNumber) ||
    left.locationCode.localeCompare(right.locationCode) ||
    left.locationName.localeCompare(right.locationName) ||
    left.lotId.localeCompare(right.lotId));
}

function formatLocalDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 3 }).format(value);
}

export function areFefoSelectionsEquivalent(
  preview: PickingFefoPreviewDto,
  confirmed: Array<{ locationId: string | null; lotId: string | null; quantity: number }>,
) {
  const canonical = (items: Array<{ locationId: string | null; lotId: string | null; quantity: number }>) =>
    [...items]
      .map((item) => `${item.locationId ?? ""}:${item.lotId ?? ""}:${item.quantity.toFixed(3)}`)
      .sort();
  return JSON.stringify(canonical(preview.resultingSelections)) === JSON.stringify(canonical(confirmed));
}
