"use client";

import { useEffect, useMemo, useState } from "react";
import type { PosApiTrackingSelection } from "@/core/repositories";
import type { PosTraceabilityCombinationDto } from "@/modules/pos/application/dto/PosTraceabilityInventoryDto";
import {
  buildPosTraceabilitySelection,
  formatQuantity,
  getPosTraceabilitySerialCapacity,
  isSelectableTraceabilityCombination,
  isValidQuantityDraft,
  planPosTraceabilityFefo,
  traceabilityCombinationKey,
  type PosTraceabilityFefoGroup,
  type PosTraceabilitySelectionRequirements,
} from "@/modules/pos/application/posTraceabilitySelection";
import { usePosTraceabilityInventory } from "@/modules/pos/hooks/usePosTraceabilityInventory";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";

export interface PosTraceabilitySelectorProduct extends PosTraceabilitySelectionRequirements {
  name: string;
  sku: string;
}

interface PosTraceabilitySelectorProps {
  open: boolean;
  product: PosTraceabilitySelectorProduct | null;
  onCancel: () => void;
  onConfirm: (selections: PosApiTrackingSelection[]) => void;
}

interface SerialGroupState {
  group: PosTraceabilityFefoGroup;
  selectedCount: number;
  unlocked: boolean;
}

export function PosTraceabilitySelector({
  open,
  product,
  onCancel,
  onConfirm,
}: PosTraceabilitySelectorProps) {
  const inventory = usePosTraceabilityInventory();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [selectedSerialIds, setSelectedSerialIds] = useState<Set<string>>(new Set());
  const [validationError, setValidationError] = useState<string | null>(null);
  const productId = product?.productId;

  useEffect(() => {
    if (!open || !productId) return;
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      setQuantities({});
      setSelectedSerialIds(new Set());
      setValidationError(null);
      void inventory.load(productId);
    });
    return () => {
      active = false;
      inventory.close();
    };
  }, [inventory.close, inventory.load, open, productId]);

  const data = inventory.data?.productId === product?.productId ? inventory.data : null;
  const combinations = data?.combinations ?? [];
  const fefoState = useMemo(() => {
    if (!data || !product?.requiresExpiration) return { plan: null, error: null };
    try {
      return { plan: planPosTraceabilityFefo(data, product), error: null };
    } catch (error) {
      return {
        plan: null,
        error: error instanceof Error ? error.message : "No se pudo calcular la asignación FEFO.",
      };
    }
  }, [data, product]);
  const automaticQuantities = useMemo(
    () =>
      new Map(
        (fefoState.plan?.allocations ?? []).map((allocation) => [
          traceabilityCombinationKey(allocation.combination),
          allocation.quantity,
        ]),
      ),
    [fefoState.plan],
  );
  const serialGroupStates = useMemo(
    () => buildSerialGroupStates(fefoState.plan?.groups ?? [], selectedSerialIds),
    [fefoState.plan, selectedSerialIds],
  );
  const serialGroupByCombination = useMemo(() => {
    const result = new Map<string, SerialGroupState>();
    for (const state of serialGroupStates) {
      for (const item of state.group.combinations) {
        result.set(traceabilityCombinationKey(item.combination), state);
      }
    }
    return result;
  }, [serialGroupStates]);
  const selectedSerialCount = selectedSerialIds.size;
  const selectedQuantity = useMemo(
    () =>
      Object.values(quantities).reduce((total, value) => {
        const quantity = Number(value);
        return Number.isFinite(quantity) ? total + quantity : total;
      }, 0),
    [quantities],
  );
  const serialSelectionComplete = useMemo(() => {
    if (!product?.requiresSerial) return true;
    if (!data) return false;
    try {
      buildPosTraceabilitySelection(data, product, { quantities, selectedSerialIds });
      return true;
    } catch {
      return false;
    }
  }, [data, product, quantities, selectedSerialIds]);

  if (!open || !product) return null;

  const resetAndCancel = () => {
    inventory.close();
    setQuantities({});
    setSelectedSerialIds(new Set());
    setValidationError(null);
    onCancel();
  };

  const confirm = () => {
    if (!data) return;
    try {
      const result = buildPosTraceabilitySelection(data, product, {
        quantities,
        selectedSerialIds,
      });
      setValidationError(null);
      onConfirm(result.selections);
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "La selección física no es válida.",
      );
    }
  };

  const visibleCombinations = combinations.filter((combination) =>
    product.requiresLot ? Boolean(combination.lot) : !combination.lot,
  );
  const orderedCombinations = product.requiresExpiration
    ? orderWithFefoFirst(visibleCombinations, fefoState.plan?.orderedCombinations ?? [])
    : visibleCombinations;
  const selectableCount = visibleCombinations.filter((combination) =>
    isSelectableTraceabilityCombination(combination, product, data?.businessDate ?? ""),
  ).length;
  const currentSelectedQuantity = product.requiresExpiration
    ? product.requiresSerial
      ? selectedSerialCount
      : (fefoState.plan?.allocations.reduce((total, item) => total + item.quantity, 0) ?? 0)
    : product.requiresSerial
      ? selectedSerialCount
      : selectedQuantity;
  const fefoUnavailable = Boolean(
    product.requiresExpiration && (!fefoState.plan || !fefoState.plan.complete),
  );

  const toggleSerial = (combination: PosTraceabilityCombinationDto, serialId: string) => {
    setValidationError(null);
    setSelectedSerialIds((current) => {
      const next = new Set(current);
      if (next.has(serialId)) {
        next.delete(serialId);
        if (product.requiresExpiration) {
          const currentDate = combination.lot?.expirationDate;
          if (currentDate) {
            for (const later of combinations) {
              if ((later.lot?.expirationDate ?? "") <= currentDate) continue;
              later.serials.forEach((serial) => next.delete(serial.serialId));
            }
          }
        }
      } else {
        next.add(serialId);
      }
      return next;
    });
  };

  return (
    <Modal
      open
      size="xl"
      title="Seleccionar inventario físico"
      subtitle={`${product.name} · ${product.sku}`}
      onClose={resetAndCancel}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-text-muted)]" aria-live="polite">
            Seleccionado: {formatQuantity(currentSelectedQuantity)} de{" "}
            {formatQuantity(product.requiredBaseQuantity)} unidades base
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" onClick={resetAndCancel}>
              Cancelar
            </Button>
            <Button
              disabled={
                inventory.status !== "loaded" ||
                selectableCount === 0 ||
                fefoUnavailable ||
                !serialSelectionComplete
              }
              type="button"
              onClick={confirm}
            >
              Usar selección
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <InlineAlert
          description="La cantidad solicitada ya está expresada en unidades base. La conversión desde la unidad de venta se resolverá antes de abrir este selector."
          title={`Debes seleccionar ${formatQuantity(product.requiredBaseQuantity)} unidades base`}
          tone="info"
        />

        {product.requiresExpiration && fefoState.plan?.complete ? (
          <InlineAlert
            description={
              product.requiresSerial
                ? "Selecciona manualmente las series de cada fecha habilitada. Debes completar las fechas más próximas antes de continuar con las posteriores."
                : "Las cantidades fueron distribuidas automáticamente entre los lotes con vencimiento más próximo."
            }
            title="Asignación FEFO automática"
            tone="info"
          />
        ) : null}

        {product.requiresExpiration &&
        visibleCombinations.length > 0 &&
        (fefoState.error || fefoState.plan?.complete === false) ? (
          <InlineAlert
            description={
              fefoState.error ??
              `Hay ${formatQuantity(fefoState.plan?.availableBaseQuantity ?? 0)} de ${formatQuantity(product.requiredBaseQuantity)} unidades base elegibles.`
            }
            title="Inventario FEFO insuficiente"
            tone="warning"
          />
        ) : null}

        {inventory.status === "loading" ? (
          <p
            className="rounded-lg border border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]"
            role="status"
          >
            Consultando ubicaciones, lotes y series disponibles...
          </p>
        ) : null}

        {inventory.status === "error" ? (
          <InlineAlert
            description={inventory.error ?? "No se pudo consultar el inventario trazable."}
            title="No se pudo cargar el inventario"
          />
        ) : null}

        {inventory.status === "loaded" && visibleCombinations.length === 0 ? (
          <InlineAlert
            description="La consulta fue exitosa, pero no devolvió combinaciones físicas disponibles para este producto."
            title="Sin inventario trazable disponible"
            tone="neutral"
          />
        ) : null}

        {inventory.status === "loaded" && orderedCombinations.length > 0 ? (
          <ul className="space-y-3">
            {orderedCombinations.map((combination) => {
              const key = traceabilityCombinationKey(combination);
              const groupState = serialGroupByCombination.get(key);
              const serialCapacity = getPosTraceabilitySerialCapacity(combination);
              const selectedInCombination = combination.serials.filter((serial) =>
                selectedSerialIds.has(serial.serialId),
              ).length;
              const groupLimitReached = Boolean(
                groupState && groupState.selectedCount >= groupState.group.requiredQuantity,
              );
              return (
                <CombinationCard
                  automaticQuantity={automaticQuantities.get(key) ?? 0}
                  businessDate={data?.businessDate ?? ""}
                  combination={combination}
                  fefoGroupState={groupState}
                  key={key}
                  product={product}
                  quantity={quantities[key] ?? ""}
                  selectedSerialIds={selectedSerialIds}
                  serialCapacity={serialCapacity}
                  serialLimitReached={
                    product.requiresExpiration
                      ? groupLimitReached
                      : selectedSerialCount >= product.requiredBaseQuantity
                  }
                  serialLocationLimitReached={selectedInCombination >= serialCapacity}
                  onQuantityChange={(value) => {
                    if (!isValidQuantityDraft(value)) return;
                    setValidationError(null);
                    setQuantities((current) => ({ ...current, [key]: value }));
                  }}
                  onSerialToggle={(serialId) => toggleSerial(combination, serialId)}
                />
              );
            })}
          </ul>
        ) : null}

        {validationError ? (
          <InlineAlert description={validationError} title="Revisa la selección" />
        ) : null}
      </div>
    </Modal>
  );
}

interface CombinationCardProps {
  automaticQuantity: number;
  businessDate: string;
  combination: PosTraceabilityCombinationDto;
  fefoGroupState?: SerialGroupState;
  product: PosTraceabilitySelectorProduct;
  quantity: string;
  selectedSerialIds: ReadonlySet<string>;
  serialCapacity: number;
  serialLimitReached: boolean;
  serialLocationLimitReached: boolean;
  onQuantityChange: (value: string) => void;
  onSerialToggle: (serialId: string) => void;
}

function CombinationCard({
  automaticQuantity,
  businessDate,
  combination,
  fefoGroupState,
  product,
  quantity,
  selectedSerialIds,
  serialCapacity,
  serialLimitReached,
  serialLocationLimitReached,
  onQuantityChange,
  onSerialToggle,
}: CombinationCardProps) {
  const selectable = isSelectableTraceabilityCombination(combination, product, businessDate);
  const expired = Boolean(
    product.requiresExpiration &&
      combination.lot?.expirationDate &&
      combination.lot.expirationDate < businessDate,
  );
  const missingExpiration = Boolean(
    product.requiresExpiration && combination.lot && !combination.lot.expirationDate,
  );
  const serialsEnabled = product.requiresExpiration
    ? selectable && Boolean(fefoGroupState?.unlocked && fefoGroupState.group.requiredQuantity > 0)
    : selectable;
  const key = traceabilityCombinationKey(combination);

  return (
    <li
      className="rounded-lg border border-[var(--color-border)] bg-white p-4"
      data-testid={`traceability-combination-${key}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[var(--color-title)]">
            {combination.location.code} · {combination.location.name}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {combination.lot ? `Lote ${combination.lot.lotNumber}` : "Sin lote"}
            {combination.lot?.expirationDate
              ? ` · vence ${formatCalendarDate(combination.lot.expirationDate)}`
              : ""}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold text-[var(--color-title)]">
            {product.requiresSerial
              ? `${serialCapacity} series disponibles`
              : `${formatQuantity(combination.availableQuantity ?? 0)} disponibles`}
          </p>
          {expired ? (
            <p className="font-semibold text-[var(--color-danger)]">Lote vencido</p>
          ) : null}
          {missingExpiration ? (
            <p className="font-semibold text-[var(--color-danger)]">
              Sin vencimiento verificable
            </p>
          ) : null}
        </div>
      </div>

      {product.requiresSerial ? (
        <fieldset className="mt-3" disabled={!serialsEnabled}>
          <legend className="text-sm font-semibold text-[var(--color-text)]">
            Números de serie
          </legend>
          {product.requiresExpiration && fefoGroupState ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Cuota FEFO de la fecha: {fefoGroupState.selectedCount} /{" "}
              {fefoGroupState.group.requiredQuantity}
              {!fefoGroupState.unlocked ? " · completa primero la fecha anterior" : ""}
            </p>
          ) : null}
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {combination.serials.map((serial) => {
              const checked = selectedSerialIds.has(serial.serialId);
              return (
                <label
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary)]/5"
                  key={serial.serialId}
                >
                  <input
                    checked={checked}
                    disabled={
                      !serialsEnabled ||
                      (!checked && (serialLimitReached || serialLocationLimitReached))
                    }
                    type="checkbox"
                    onChange={() => onSerialToggle(serial.serialId)}
                  />
                  <span>{serial.serialNumber}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : product.requiresExpiration ? (
        <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <span className="font-semibold text-[var(--color-text)]">Asignación FEFO: </span>
          <span className="text-[var(--color-text-muted)]">
            {automaticQuantity > 0
              ? `${formatQuantity(automaticQuantity)} unidades base`
              : selectable
                ? "No requerido para esta venta"
                : "No elegible"}
          </span>
        </div>
      ) : (
        <label className="mt-3 block max-w-52 text-sm font-semibold text-[var(--color-text)]">
          Cantidad en unidades base
          <Input
            aria-label={`Cantidad del lote ${combination.lot?.lotNumber ?? combination.location.code}`}
            className="mt-1"
            disabled={!selectable}
            inputMode="decimal"
            placeholder="0"
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
          />
        </label>
      )}
    </li>
  );
}

function buildSerialGroupStates(
  groups: PosTraceabilityFefoGroup[],
  selectedSerialIds: ReadonlySet<string>,
): SerialGroupState[] {
  let previousComplete = true;
  return groups.map((group) => {
    const selectedCount = group.combinations.reduce(
      (total, item) =>
        total +
        item.combination.serials.filter((serial) => selectedSerialIds.has(serial.serialId)).length,
      0,
    );
    const state = { group, selectedCount, unlocked: previousComplete };
    previousComplete = previousComplete && selectedCount === group.requiredQuantity;
    return state;
  });
}

function orderWithFefoFirst(
  visible: PosTraceabilityCombinationDto[],
  eligibleInFefoOrder: PosTraceabilityCombinationDto[],
) {
  const order = new Map(
    eligibleInFefoOrder.map((combination, index) => [traceabilityCombinationKey(combination), index]),
  );
  return visible.slice().sort((left, right) => {
    const leftOrder = order.get(traceabilityCombinationKey(left));
    const rightOrder = order.get(traceabilityCombinationKey(right));
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return traceabilityCombinationKey(left).localeCompare(traceabilityCombinationKey(right));
  });
}

function formatCalendarDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
