import type { PosApiTrackingSelection } from "@/core/repositories";
import type {
  PosTraceabilityCombinationDto,
  PosTraceabilityInventoryDto,
} from "@/modules/pos/application/dto/PosTraceabilityInventoryDto";
import {
  canonicalizePosTrackingSelections,
  normalizePosTrackingQuantity,
} from "@/modules/pos/application/posTrackingSelection";

const QUANTITY_SCALE = 1000;

export interface PosTraceabilitySelectionRequirements {
  productId: string;
  requiredBaseQuantity: number;
  requiresLot: boolean;
  requiresSerial: boolean;
  requiresExpiration: boolean;
}

export interface PosTraceabilitySelectionDraft {
  quantities: Readonly<Record<string, string>>;
  selectedSerialIds: ReadonlySet<string>;
}

export interface PosTraceabilitySelectionResult {
  selections: PosApiTrackingSelection[];
  selectedBaseQuantity: number;
}

export interface PosTraceabilityFefoAllocation {
  combination: PosTraceabilityCombinationDto;
  quantity: number;
}

export interface PosTraceabilityFefoGroup {
  expirationDate: string;
  requiredQuantity: number;
  availableQuantity: number;
  combinations: Array<{
    combination: PosTraceabilityCombinationDto;
    capacity: number;
  }>;
}

export interface PosTraceabilityFefoPlan {
  allocations: PosTraceabilityFefoAllocation[];
  groups: PosTraceabilityFefoGroup[];
  orderedCombinations: PosTraceabilityCombinationDto[];
  requiredBaseQuantity: number;
  availableBaseQuantity: number;
  complete: boolean;
}

export function traceabilityCombinationKey(
  combination: Pick<PosTraceabilityCombinationDto, "location" | "lot">,
): string {
  return `${combination.location.id}:${combination.lot?.lotId ?? ""}`;
}

export function isSelectableTraceabilityCombination(
  combination: PosTraceabilityCombinationDto,
  requirements: PosTraceabilitySelectionRequirements,
  businessDate: string,
): boolean {
  if (requirements.requiresLot && !combination.lot) return false;
  if (!requirements.requiresLot && combination.lot) return false;
  if (requirements.requiresExpiration) {
    const expirationDate = combination.lot?.expirationDate;
    if (!expirationDate || expirationDate < businessDate) return false;
  }
  if (requirements.requiresSerial) return combination.serials.length > 0;
  return (combination.availableQuantity ?? 0) > 0;
}

/**
 * Calcula una asignación FEFO sin modificar el inventario recibido. Para productos serializados
 * solo calcula la cuota exigida por fecha; la serie física siempre la elige el cajero.
 */
export function planPosTraceabilityFefo(
  inventory: PosTraceabilityInventoryDto,
  requirements: PosTraceabilitySelectionRequirements,
): PosTraceabilityFefoPlan {
  const requiredBaseQuantity = normalizeRequirements(inventory, requirements);
  if (!requirements.requiresExpiration) {
    throw new Error("El plan FEFO solo aplica a productos con seguimiento de vencimiento.");
  }

  const eligible = inventory.combinations
    .filter((combination) =>
      isSelectableTraceabilityCombination(combination, requirements, inventory.businessDate),
    )
    .slice()
    .sort(compareFefoCombinations);

  if (requirements.requiresSerial) {
    const groupsByDate = new Map<string, PosTraceabilityFefoGroup["combinations"]>();
    for (const combination of eligible) {
      const expirationDate = combination.lot?.expirationDate;
      if (!expirationDate) continue;
      const capacity = getPosTraceabilitySerialCapacity(combination);
      if (capacity <= 0) continue;
      const current = groupsByDate.get(expirationDate) ?? [];
      current.push({ combination, capacity });
      groupsByDate.set(expirationDate, current);
    }

    let remaining = requiredBaseQuantity;
    const groups = [...groupsByDate.entries()].map(([expirationDate, combinations]) => {
      const availableQuantity = combinations.reduce((total, item) => total + item.capacity, 0);
      const requiredQuantity = Math.min(remaining, availableQuantity);
      remaining -= requiredQuantity;
      return { expirationDate, requiredQuantity, availableQuantity, combinations };
    });
    const availableBaseQuantity = groups.reduce(
      (total, group) => total + group.availableQuantity,
      0,
    );
    return {
      allocations: [],
      groups,
      orderedCombinations: eligible,
      requiredBaseQuantity,
      availableBaseQuantity,
      complete: remaining === 0,
    };
  }

  let remainingUnits = toQuantityUnits(requiredBaseQuantity);
  let availableUnits = 0;
  const allocations: PosTraceabilityFefoAllocation[] = [];
  for (const combination of eligible) {
    const capacityUnits = toQuantityUnits(combination.availableQuantity ?? 0);
    availableUnits += capacityUnits;
    const assignedUnits = Math.min(remainingUnits, capacityUnits);
    if (assignedUnits > 0) {
      allocations.push({ combination, quantity: assignedUnits / QUANTITY_SCALE });
      remainingUnits -= assignedUnits;
    }
  }
  return {
    allocations,
    groups: [],
    orderedCombinations: eligible,
    requiredBaseQuantity,
    availableBaseQuantity: availableUnits / QUANTITY_SCALE,
    complete: remainingUnits === 0,
  };
}

export function buildPosTraceabilitySelection(
  inventory: PosTraceabilityInventoryDto,
  requirements: PosTraceabilitySelectionRequirements,
  draft: PosTraceabilitySelectionDraft,
): PosTraceabilitySelectionResult {
  const requiredBaseQuantity = normalizeRequirements(inventory, requirements);
  if (requirements.requiresExpiration) {
    return buildFefoSelection(inventory, requirements, draft, requiredBaseQuantity);
  }
  return buildManualSelection(inventory, requirements, draft, requiredBaseQuantity);
}

function buildFefoSelection(
  inventory: PosTraceabilityInventoryDto,
  requirements: PosTraceabilitySelectionRequirements,
  draft: PosTraceabilitySelectionDraft,
  requiredBaseQuantity: number,
): PosTraceabilitySelectionResult {
  const plan = planPosTraceabilityFefo(inventory, requirements);
  if (!plan.complete) {
    throw new Error(
      `Inventario FEFO insuficiente: hay ${formatQuantity(plan.availableBaseQuantity)} de ${formatQuantity(requiredBaseQuantity)} unidades base requeridas.`,
    );
  }

  if (!requirements.requiresSerial) {
    return selectionResult(
      plan.allocations.map(({ combination, quantity }) => ({
        productId: requirements.productId,
        locationId: combination.location.id,
        lotId: combination.lot?.lotId ?? null,
        quantity,
        serialNumbers: [],
      })),
      requiredBaseQuantity,
    );
  }

  const selectedByCombination = collectSelectedSerials(
    inventory,
    requirements,
    draft.selectedSerialIds,
  );
  const plannedCombinationKeys = new Set(
    plan.groups.flatMap((group) =>
      group.combinations.map((item) => traceabilityCombinationKey(item.combination)),
    ),
  );
  if ([...selectedByCombination.keys()].some((key) => !plannedCombinationKeys.has(key))) {
    throw new Error("Una o más series seleccionadas no tienen capacidad FEFO disponible.");
  }
  const selections: PosApiTrackingSelection[] = [];
  for (const group of plan.groups) {
    const selectedInGroup = group.combinations.reduce(
      (total, item) =>
        total +
        (selectedByCombination.get(traceabilityCombinationKey(item.combination))?.length ?? 0),
      0,
    );
    if (selectedInGroup !== group.requiredQuantity) {
      throw new Error(
        group.requiredQuantity === 0
          ? `No puedes utilizar series con vencimiento ${formatCalendarDate(group.expirationDate)} mientras exista capacidad FEFO anterior.`
          : `Selecciona exactamente ${group.requiredQuantity} serie(s) con vencimiento ${formatCalendarDate(group.expirationDate)}.`,
      );
    }
    for (const item of group.combinations) {
      const serials = selectedByCombination.get(traceabilityCombinationKey(item.combination)) ?? [];
      if (serials.length === 0) continue;
      if (serials.length > item.capacity) {
        throw new Error(
          `La cantidad seleccionada en ${item.combination.location.name} supera la disponibilidad.`,
        );
      }
      selections.push({
        productId: requirements.productId,
        locationId: item.combination.location.id,
        lotId: item.combination.lot?.lotId ?? null,
        quantity: serials.length,
        serialNumbers: serials.map((serial) => serial.serialNumber),
      });
    }
  }
  return selectionResult(selections, requiredBaseQuantity);
}

function buildManualSelection(
  inventory: PosTraceabilityInventoryDto,
  requirements: PosTraceabilitySelectionRequirements,
  draft: PosTraceabilitySelectionDraft,
  requiredBaseQuantity: number,
): PosTraceabilitySelectionResult {
  const selections: PosApiTrackingSelection[] = [];
  if (requirements.requiresSerial) {
    const selectedByCombination = collectSelectedSerials(
      inventory,
      requirements,
      draft.selectedSerialIds,
    );
    for (const combination of inventory.combinations) {
      const serials = selectedByCombination.get(traceabilityCombinationKey(combination)) ?? [];
      if (serials.length === 0) continue;
      const capacity = getPosTraceabilitySerialCapacity(combination);
      if (serials.length > capacity) {
        throw new Error(
          `La cantidad seleccionada en ${combination.location.name} supera la disponibilidad.`,
        );
      }
      selections.push({
        productId: requirements.productId,
        locationId: combination.location.id,
        lotId: combination.lot?.lotId ?? null,
        quantity: serials.length,
        serialNumbers: serials.map((serial) => serial.serialNumber),
      });
    }
    return selectionResult(selections, requiredBaseQuantity);
  }

  for (const combination of inventory.combinations) {
    if (
      !isSelectableTraceabilityCombination(combination, requirements, inventory.businessDate)
    ) {
      continue;
    }
    const rawQuantity = draft.quantities[traceabilityCombinationKey(combination)]?.trim() ?? "";
    if (!rawQuantity || Number(rawQuantity) === 0) continue;
    const quantity = normalizePosTrackingQuantity(Number(rawQuantity));
    const availableQuantity = combination.availableQuantity ?? 0;
    if (quantity > availableQuantity) {
      throw new Error(
        `La cantidad seleccionada en ${combination.location.name} supera la disponibilidad.`,
      );
    }
    selections.push({
      productId: requirements.productId,
      locationId: combination.location.id,
      lotId: combination.lot?.lotId ?? null,
      quantity,
      serialNumbers: [],
    });
  }
  return selectionResult(selections, requiredBaseQuantity);
}

function collectSelectedSerials(
  inventory: PosTraceabilityInventoryDto,
  requirements: PosTraceabilitySelectionRequirements,
  selectedSerialIds: ReadonlySet<string>,
) {
  const result = new Map<string, PosTraceabilityCombinationDto["serials"]>();
  const foundIds = new Set<string>();
  for (const combination of inventory.combinations) {
    if (
      !isSelectableTraceabilityCombination(combination, requirements, inventory.businessDate)
    ) {
      continue;
    }
    const selected = combination.serials.filter((serial) => {
      if (!selectedSerialIds.has(serial.serialId)) return false;
      if (foundIds.has(serial.serialId)) {
        throw new Error("Una serie no puede seleccionarse más de una vez.");
      }
      foundIds.add(serial.serialId);
      return true;
    });
    if (selected.length > 0) result.set(traceabilityCombinationKey(combination), selected);
  }
  if (foundIds.size !== selectedSerialIds.size) {
    throw new Error("Una o más series seleccionadas ya no están disponibles en este contexto.");
  }
  return result;
}

function selectionResult(
  selections: PosApiTrackingSelection[],
  requiredBaseQuantity: number,
): PosTraceabilitySelectionResult {
  const canonical = canonicalizePosTrackingSelections(selections);
  const selectedUnits = canonical.reduce(
    (total, selection) => total + toQuantityUnits(selection.quantity),
    0,
  );
  const requiredUnits = toQuantityUnits(requiredBaseQuantity);
  if (selectedUnits !== requiredUnits) {
    throw new Error(
      `Selecciona exactamente ${formatQuantity(requiredBaseQuantity)} unidades base de inventario.`,
    );
  }
  return { selections: canonical, selectedBaseQuantity: selectedUnits / QUANTITY_SCALE };
}

function normalizeRequirements(
  inventory: PosTraceabilityInventoryDto,
  requirements: PosTraceabilitySelectionRequirements,
) {
  if (inventory.productId !== requirements.productId) {
    throw new Error("El inventario consultado no corresponde al producto seleccionado.");
  }
  if (requirements.requiresExpiration && !requirements.requiresLot) {
    throw new Error("La trazabilidad por vencimiento requiere control por lote.");
  }
  const requiredBaseQuantity = normalizePosTrackingQuantity(requirements.requiredBaseQuantity);
  if (requirements.requiresSerial && !Number.isInteger(requiredBaseQuantity)) {
    throw new Error("Los productos serializados requieren una cantidad base entera.");
  }
  return requiredBaseQuantity;
}

export function getPosTraceabilitySerialCapacity(combination: PosTraceabilityCombinationDto) {
  const availableSerials = combination.serials.length;
  if (availableSerials === 0) return 0;
  if (combination.availableQuantity === null) return availableSerials;
  if (combination.availableQuantity <= 0) return 0;
  const availableQuantity = normalizePosTrackingQuantity(combination.availableQuantity);
  return Math.min(availableSerials, Math.floor(availableQuantity));
}

function compareFefoCombinations(
  left: PosTraceabilityCombinationDto,
  right: PosTraceabilityCombinationDto,
) {
  return (
    (left.lot?.expirationDate ?? "9999-12-31").localeCompare(
      right.lot?.expirationDate ?? "9999-12-31",
    ) ||
    (left.lot?.lotNumber ?? "").localeCompare(right.lot?.lotNumber ?? "") ||
    left.location.code.localeCompare(right.location.code) ||
    left.location.id.localeCompare(right.location.id) ||
    (left.lot?.lotId ?? "").localeCompare(right.lot?.lotId ?? "")
  );
}

function toQuantityUnits(quantity: number) {
  if (quantity === 0) return 0;
  return Math.round(normalizePosTrackingQuantity(quantity) * QUANTITY_SCALE);
}

export function isValidQuantityDraft(value: string): boolean {
  return /^\d*(?:\.\d{0,3})?$/.test(value);
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 3 }).format(value);
}

function formatCalendarDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
