import { LocationStatus } from "@/core/enums";
import type {
  AdjustmentLotOption,
  AdjustmentSerialOption,
} from "@/core/repositories/InventoryAdjustmentRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  PosTraceabilityCombinationDto,
  PosTraceabilityInventoryDto,
  PosTraceabilityInventoryQueryDto,
  PosTraceabilityLocationDto,
  PosTraceabilityLotDto,
  PosTraceabilitySerialDto,
} from "@/modules/pos/application/dto/PosTraceabilityInventoryDto";
import {
  ensurePosBranchAccess,
  PosServiceError,
  resolvePosSessionContext,
} from "@/modules/pos/application/services/posServiceContext";

export const POS_TRACEABILITY_STOCK_PERMISSION = "inventory.stock.read";
export const POS_TRACEABILITY_LOCATIONS_PERMISSION = "catalog.locations.read";
const DEFAULT_BUSINESS_TIME_ZONE = "America/Guatemala";

function getBusinessDate(timeZone: string, now = new Date()): string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeOptionalId(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function requireQueryId(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new PosServiceError(`Debe indicar ${label} para consultar el inventario trazable.`);
  }
  return normalized;
}

function ensureTraceabilityPermissions(permissions: readonly string[]) {
  if (
    permissions.includes(POS_TRACEABILITY_STOCK_PERMISSION) &&
    permissions.includes(POS_TRACEABILITY_LOCATIONS_PERMISSION)
  ) {
    return;
  }
  throw new PosServiceError(
    "No dispone de permisos para consultar inventario trazable y ubicaciones de la sucursal.",
  );
}

function sortLocations(left: PosTraceabilityLocationDto, right: PosTraceabilityLocationDto) {
  return left.code.localeCompare(right.code) || left.id.localeCompare(right.id);
}

function sortLots(left: PosTraceabilityLotDto, right: PosTraceabilityLotDto) {
  return (
    left.locationId.localeCompare(right.locationId) ||
    left.lotNumber.localeCompare(right.lotNumber) ||
    left.lotId.localeCompare(right.lotId)
  );
}

function sortSerials(left: PosTraceabilitySerialDto, right: PosTraceabilitySerialDto) {
  return (
    left.locationId.localeCompare(right.locationId) ||
    (left.lotId ?? "").localeCompare(right.lotId ?? "") ||
    left.serialNumber.localeCompare(right.serialNumber) ||
    left.serialId.localeCompare(right.serialId)
  );
}

function toLot(
  option: AdjustmentLotOption,
  activeLocationIds: ReadonlySet<string>,
): PosTraceabilityLotDto | null {
  if (
    !option.locationId ||
    !activeLocationIds.has(option.locationId) ||
    option.availableQuantity <= 0
  ) {
    return null;
  }
  return {
    lotId: option.lotId,
    lotNumber: option.lotNumber,
    expirationDate: option.expirationDate ?? null,
    locationId: option.locationId,
    quantity: option.quantity,
    reservedQuantity: option.reservedQuantity,
    availableQuantity: option.availableQuantity,
  };
}

function toSerial(
  option: AdjustmentSerialOption,
  activeLocationIds: ReadonlySet<string>,
): PosTraceabilitySerialDto | null {
  if (!option.locationId || !activeLocationIds.has(option.locationId)) return null;
  return {
    serialId: option.serialId,
    serialNumber: option.serialNumber.trim(),
    locationId: option.locationId,
    lotId: option.lotId ?? null,
  };
}

function buildCombinations(
  locations: PosTraceabilityLocationDto[],
  lots: PosTraceabilityLotDto[],
  serials: PosTraceabilitySerialDto[],
): PosTraceabilityCombinationDto[] {
  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const lotsByKey = new Map(lots.map((lot) => [`${lot.locationId}:${lot.lotId}`, lot]));
  const combinations = new Map<string, PosTraceabilityCombinationDto>();

  for (const lot of lots) {
    const location = locationsById.get(lot.locationId);
    if (!location) continue;
    combinations.set(`${lot.locationId}:${lot.lotId}`, {
      location,
      lot: {
        lotId: lot.lotId,
        lotNumber: lot.lotNumber,
        expirationDate: lot.expirationDate,
      },
      quantity: lot.quantity,
      reservedQuantity: lot.reservedQuantity,
      availableQuantity: lot.availableQuantity,
      serials: [],
      availableSerialCount: 0,
    });
  }

  for (const serial of serials) {
    const location = locationsById.get(serial.locationId);
    if (!location) continue;
    const key = `${serial.locationId}:${serial.lotId ?? ""}`;
    if (serial.lotId && !lotsByKey.has(key)) {
      throw new PosServiceError(
        "El servidor devolvio una serie asociada a un lote sin disponibilidad consultable.",
      );
    }
    const existing = combinations.get(key);
    if (existing) {
      existing.serials.push(serial);
      existing.availableSerialCount = existing.serials.length;
      continue;
    }
    combinations.set(key, {
      location,
      lot: null,
      quantity: null,
      reservedQuantity: null,
      availableQuantity: null,
      serials: [serial],
      availableSerialCount: 1,
    });
  }

  return [...combinations.values()].sort(
    (left, right) =>
      left.location.code.localeCompare(right.location.code) ||
      (left.lot?.lotNumber ?? "").localeCompare(right.lot?.lotNumber ?? ""),
  );
}

export class GetPosTraceabilityInventoryService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: PosTraceabilityInventoryQueryDto): Promise<PosTraceabilityInventoryDto> {
    if (this.repositories.inventoryStockDataSource !== "api") {
      throw new PosServiceError("La consulta API de inventario trazable no esta activa.");
    }

    const branchId = requireQueryId(input.branchId, "la sucursal");
    const productId = requireQueryId(input.productId, "el producto");
    const locationId = normalizeOptionalId(input.locationId);
    const lotId = normalizeOptionalId(input.lotId);
    const session = await resolvePosSessionContext(this.repositories);
    ensureTraceabilityPermissions(session.permissions);
    await ensurePosBranchAccess(this.repositories, session.user, branchId);

    const rawLocations = await this.repositories.inventory.getLocations(branchId);
    const locations = rawLocations
      .filter(
        (location) =>
          location.tenantId === session.tenantId &&
          location.branchId === branchId &&
          location.status === LocationStatus.active,
      )
      .map<PosTraceabilityLocationDto>((location) => ({
        id: location.id,
        code: location.code,
        name: location.name,
        type: location.type,
      }))
      .sort(sortLocations);
    const activeLocationIds = new Set(locations.map((location) => location.id));

    if (locationId && !activeLocationIds.has(locationId)) {
      throw new PosServiceError("La ubicacion seleccionada no esta activa en la sucursal actual.");
    }

    const [rawLots, rawSerials] = await Promise.all([
      this.repositories.inventoryAdjustments.listAvailableLots({
        branchId,
        productId,
        locationId,
      }),
      this.repositories.inventoryAdjustments.listAvailableSerials({
        branchId,
        productId,
        locationId,
        lotId,
      }),
    ]);

    const lots = rawLots
      .map((lot) => toLot(lot, activeLocationIds))
      .filter((lot): lot is PosTraceabilityLotDto => Boolean(lot))
      .filter((lot) => !locationId || lot.locationId === locationId)
      .filter((lot) => !lotId || lot.lotId === lotId)
      .sort(sortLots);
    const serials = rawSerials
      .map((serial) => toSerial(serial, activeLocationIds))
      .filter((serial): serial is PosTraceabilitySerialDto => Boolean(serial))
      .filter((serial) => !locationId || serial.locationId === locationId)
      .filter((serial) => !lotId || serial.lotId === lotId)
      .sort(sortSerials);

    const serialKeys = new Set<string>();
    for (const serial of serials) {
      const key = serial.serialNumber.toUpperCase();
      if (!serial.serialNumber || serialKeys.has(key)) {
        throw new PosServiceError("El servidor devolvio numeros de serie vacios o duplicados.");
      }
      serialKeys.add(key);
    }

    return {
      branchId,
      productId,
      businessDate: getBusinessDate(session.tenant.timezone),
      locations,
      lots,
      serials,
      combinations: buildCombinations(locations, lots, serials),
    };
  }
}
