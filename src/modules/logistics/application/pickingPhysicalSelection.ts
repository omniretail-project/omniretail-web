import type { PickingTrackingSelectionCommand } from "@/core/repositories";
import type { PickingDetailLineDto } from "@/modules/logistics/application/dto/PickingReadModelDto";

export interface PickingPhysicalSelectionInput {
  locationId: string | null;
  lotId: string | null;
  serialNumbers: string[];
}

export interface PickingPhysicalSelectionResult {
  locationId: string | null;
  trackingSelections: PickingTrackingSelectionCommand[];
}

export interface PickingLineUpdateAvailability {
  available: boolean;
  reason: string | null;
}

type PickingInventoryLocation = PickingDetailLineDto["inventory"]["locations"][number];
type PickingInventoryLot = PickingInventoryLocation["lots"][number];
type PickingInventorySerial = PickingInventoryLocation["serialNumbers"][number];

export interface PickingCanonicalLocationCandidates {
  location: PickingInventoryLocation;
  lots: PickingInventoryLot[];
  serialNumbers: PickingInventorySerial[];
}

const QUANTITY_SCALE = 1_000;

export function getPickingLineUpdateAvailability(
  line: PickingDetailLineDto,
): PickingLineUpdateAvailability {
  if (!isTraceable(line)) return { available: true, reason: null };

  const effectiveLocationId = line.location?.id ?? line.trackingSelections[0]?.locationId;
  const candidateLocations = resolvePickingCanonicalCandidates(line).filter((candidate) =>
    effectiveLocationId ? candidate.location.locationId === effectiveLocationId : true,
  );
  if (candidateLocations.length === 0) {
    return unavailableTraceability("ubicaciones");
  }

  if (line.tracking.serial) {
    const hasCanonicalSerial = candidateLocations.some(
      (candidate) => candidate.serialNumbers.length > 0,
    );
    if (!hasCanonicalSerial) return unavailableTraceability("series");
  } else if (line.tracking.lot || line.tracking.expiration) {
    const hasCanonicalLot = candidateLocations.some((candidate) => candidate.lots.length > 0);
    if (!hasCanonicalLot) return unavailableTraceability("lotes");
  }

  return { available: true, reason: null };
}

export function buildPickingPhysicalSelection(
  line: PickingDetailLineDto,
  targetQuantity: number,
  input: PickingPhysicalSelectionInput,
): PickingPhysicalSelectionResult {
  if (!isTraceable(line)) {
    return { locationId: input.locationId, trackingSelections: [] };
  }
  const availability = getPickingLineUpdateAvailability(line);
  if (!availability.available) throw new Error(availability.reason ?? "Trazabilidad no disponible.");
  if (!input.locationId) throw new Error("Selecciona la ubicacion fisica.");
  const canonicalLocation = resolvePickingCanonicalCandidates(line).find(
    (candidate) => candidate.location.locationId === input.locationId,
  );
  if (!canonicalLocation) throw new Error("La ubicacion seleccionada no es canonica.");
  const current = line.trackingSelections.map((selection) => ({
    locationId: requireLocation(selection.locationId),
    lotId: selection.lotId,
    quantity: normalizePickingQuantity(selection.quantity),
    serialNumbers: [...selection.serialNumbers],
  }));
  if (current.some((selection) => selection.locationId !== input.locationId)) {
    throw new Error("La seleccion existente pertenece a otra ubicacion.");
  }
  const delta = subtractPickingQuantities(targetQuantity, line.pickedQuantity);
  if (line.tracking.serial) {
    for (const serialNumber of input.serialNumbers) {
      const serial = canonicalLocation.serialNumbers.find(
        (candidate) => candidate.serialNumber === serialNumber,
      );
      if (!serial) throw new Error(`La serie ${serialNumber} no es canonica para la ubicacion.`);
      mergeSelection(current, input.locationId, serial.lotId ?? null, 1, [serialNumber]);
    }
  } else {
    if (line.tracking.lot && !input.lotId) throw new Error("Selecciona el lote fisico.");
    if (input.lotId && !canonicalLocation.lots.some((lot) => lot.lotId === input.lotId)) {
      throw new Error("El lote seleccionado no esta disponible en la ubicacion.");
    }
    mergeSelection(current, input.locationId, input.lotId, delta, []);
  }
  return { locationId: input.locationId, trackingSelections: current };
}

export function buildPickingSerialReplacement(
  line: PickingDetailLineDto,
  serialNumbers: string[],
): PickingPhysicalSelectionResult {
  const availability = getPickingLineUpdateAvailability(line);
  if (!availability.available) throw new Error(availability.reason ?? "Trazabilidad no disponible.");
  const selections: PickingTrackingSelectionCommand[] = [];
  let locationId: string | null = line.location?.id ?? null;
  for (const serialNumber of serialNumbers) {
    const trace = findSerialTrace(line, serialNumber);
    if (!trace) throw new Error(`No se encontro la trazabilidad de la serie ${serialNumber}.`);
    locationId ??= trace.locationId;
    if (trace.locationId !== locationId) {
      throw new Error("El backend exige que todas las series de una linea usen la misma ubicacion.");
    }
    mergeSelection(selections, trace.locationId, trace.lotId, 1, [serialNumber]);
  }
  if (!locationId) throw new Error("Selecciona la ubicacion fisica.");
  return { locationId, trackingSelections: selections };
}

export function getPickingLocationLots(line: PickingDetailLineDto, locationId: string | null) {
  return resolvePickingCanonicalCandidates(line).find(
    (candidate) => candidate.location.locationId === locationId,
  )?.lots ?? [];
}

export function getPickingLocationSerials(line: PickingDetailLineDto, locationId: string | null) {
  return resolvePickingCanonicalCandidates(line).find(
    (candidate) => candidate.location.locationId === locationId,
  )?.serialNumbers.map((serial) => serial.serialNumber) ?? [];
}

export function getPickingCanonicalLocationIds(line: PickingDetailLineDto): string[] {
  return resolvePickingCanonicalCandidates(line).map(
    (candidate) => candidate.location.locationId as string,
  );
}

export function resolvePickingCanonicalCandidates(
  line: PickingDetailLineDto,
): PickingCanonicalLocationCandidates[] {
  const availableLocationIds = new Set(
    line.availableLocations.flatMap((location) => location.id ? [location.id] : []),
  );
  const availableLotIds = new Set(line.availableLots.map((lot) => lot.id));
  const availableSerialNumbers = new Set(line.availableSerialNumbers);

  return line.inventory.locations.flatMap((location) => {
    if (!location.locationId || !availableLocationIds.has(location.locationId)) return [];
    const lots = location.lots.filter((lot) => availableLotIds.has(lot.lotId));
    const canonicalLotIds = new Set(lots.map((lot) => lot.lotId));
    const serialNumbers = location.serialNumbers.filter((serial) => {
      if (!availableSerialNumbers.has(serial.serialNumber)) return false;
      const requiresCanonicalLot =
        line.tracking.lot || line.tracking.expiration || serial.lotId !== null;
      return !requiresCanonicalLot || Boolean(serial.lotId && canonicalLotIds.has(serial.lotId));
    });
    return [{ location, lots, serialNumbers }];
  });
}

export function normalizePickingQuantity(value: number): number {
  if (!Number.isFinite(value)) throw new Error("La cantidad debe ser un numero finito.");
  const scaled = value * QUANTITY_SCALE;
  const integer = Math.round(scaled);
  if (!Number.isSafeInteger(integer) || Math.abs(scaled - integer) > 1e-9) {
    throw new Error("La cantidad admite como maximo 3 decimales.");
  }
  return integer / QUANTITY_SCALE;
}

function subtractPickingQuantities(minuend: number, subtrahend: number): number {
  return (toQuantityUnits(minuend) - toQuantityUnits(subtrahend)) / QUANTITY_SCALE;
}

function findSerialTrace(line: PickingDetailLineDto, serialNumber: string) {
  for (const candidate of resolvePickingCanonicalCandidates(line)) {
    const serial = candidate.serialNumbers.find((item) => item.serialNumber === serialNumber);
    if (serial && candidate.location.locationId) {
      return { locationId: candidate.location.locationId, lotId: serial.lotId ?? null };
    }
  }
  for (const selection of line.trackingSelections) {
    if (selection.locationId && selection.serialNumbers.includes(serialNumber)) {
      return { locationId: selection.locationId, lotId: selection.lotId };
    }
  }
  return null;
}

function mergeSelection(
  selections: PickingTrackingSelectionCommand[],
  locationId: string,
  lotId: string | null,
  quantity: number,
  serialNumbers: string[],
) {
  const existing = selections.find(
    (selection) => selection.locationId === locationId && selection.lotId === lotId,
  );
  if (existing) {
    existing.quantity = (toQuantityUnits(existing.quantity) + toQuantityUnits(quantity)) / QUANTITY_SCALE;
    existing.serialNumbers = [...existing.serialNumbers, ...serialNumbers];
    return;
  }
  selections.push({
    locationId,
    lotId,
    quantity: normalizePickingQuantity(quantity),
    serialNumbers: [...serialNumbers],
  });
}

function toQuantityUnits(value: number): number {
  return Math.round(normalizePickingQuantity(value) * QUANTITY_SCALE);
}

function unavailableTraceability(candidateType: string): PickingLineUpdateAvailability {
  return {
    available: false,
    reason: `El servidor no proporciono ${candidateType} canonicos para actualizar esta linea.`,
  };
}

function requireLocation(locationId: string | null): string {
  if (!locationId) throw new Error("La seleccion fisica existente no posee ubicacion.");
  return locationId;
}

function isTraceable(line: PickingDetailLineDto) {
  return line.tracking.lot || line.tracking.expiration || line.tracking.serial;
}
