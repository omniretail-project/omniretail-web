import type {
  InventoryBalance,
  InventoryMovement,
  ProductInventorySettings,
  StorageLocation,
} from "@/core/entities";
import type {
  AdjustmentLotOption,
  AdjustmentSerialOption,
  SerialValidationResult,
} from "@/core/repositories";
import type { InventoryProductRow } from "@/modules/inventory/application/dto/InventoryAlertsDto";
import { InventoryAdjustmentType, LocationStatus, ProductType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { AdjustStockDto } from "@/modules/inventory/application/dto/InventoryAlertsDto";
import { toBaseQuantity } from "@/core/units";
import {
  ensureCanCreateAdjustment,
  ensureProductBelongsToTenant,
  ensureTenantCanUseInventory,
  ensureTenantCanUseTracking,
  ensureUserCanOperateInventoryBranch,
  InventoryServiceError,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";
import {
  EXPIRATION_BEFORE_ENTRY_MESSAGE,
  getLocalCalendarDate,
  isExpirationBeforeOperationDate,
} from "@/core/inventory/expirationDate";
import { MAX_SAFE_INVENTORY_QUANTITY, TEXT_LIMITS } from "@/shared/utils/inputLimits";
import { isQuantityCompatibleWithUnit } from "@/shared/utils/numberInput";
import { BackendRequestError } from "@/infrastructure/api/backendClient";

export interface RegisterInventoryAdjustmentResult {
  adjustmentNumber: string;
  movement: InventoryMovement;
}

export class RegisterInventoryAdjustmentService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(dto: AdjustStockDto): Promise<RegisterInventoryAdjustmentResult> {
    const { tenantId, actorUserId, user, permissions } = await resolveInventoryContext(
      this.repositories,
    );
    ensureCanCreateAdjustment(permissions);
    const entitlements = await ensureTenantCanUseInventory(this.repositories, tenantId);
    if (this.repositories.inventoryStockDataSource === "api") {
      return this.executeApi(dto, { tenantId, actorUserId, user, entitlements });
    }
    const product = ensureProductBelongsToTenant(
      await this.repositories.products.getById(dto.productId),
      tenantId,
    );
    const businessCapabilities = await this.repositories.businessConfig.getCapabilities(tenantId);
    if (businessCapabilities) {
      ensureTenantCanUseTracking(entitlements, businessCapabilities, product);
    }
    // Sin configuracion del negocio el backend interpreta false: no se asume true.
    const usesLocations = businessCapabilities?.supportsMultipleLocations ?? false;
    await ensureUserCanOperateInventoryBranch(this.repositories, user, dto.branchId);
    const reason = dto.reason.trim();
    if (!reason) throw new Error("El motivo es requerido.");
    if (reason.length > TEXT_LIMITS.reason)
      throw new Error("El motivo admite hasta 200 caracteres.");
    if ((dto.notes?.length ?? 0) > TEXT_LIMITS.notes)
      throw new Error("Las observaciones admiten hasta 500 caracteres.");
    if ((dto.lotNumber?.length ?? 0) > TEXT_LIMITS.lotNumber)
      throw new Error("El lote admite hasta 50 caracteres.");
    if ((dto.serialNumbers?.join("\n").length ?? 0) > TEXT_LIMITS.serialNumbers) {
      throw new Error("Los numeros de serie admiten hasta 5,000 caracteres.");
    }
    const operational = await this.resolveOperationalBalance({
      tenantId,
      branchId: dto.branchId,
      productId: dto.productId,
      movementKind: dto.movementKind,
      requestedLocationId: dto.locationId,
      usesLocations,
      fresh: true,
    });
    const locationId = operational.locationId;
    const [conversions, supplierProducts, selectedUnit, baseUnit] = await Promise.all([
      this.repositories.units.getConversionsByProductScoped(product.tenantId, product.id),
      this.repositories.supplierProducts.getByProductForTenant(product.tenantId, product.id),
      this.repositories.units.getByIdScoped(tenantId, dto.unitId),
      this.repositories.units.getByIdScoped(tenantId, product.baseUnitId),
    ]);
    if (!selectedUnit || !baseUnit) {
      throw new InventoryServiceError("La unidad seleccionada no esta disponible.");
    }
    assertValidInventoryQuantity(dto.quantity, selectedUnit.allowsDecimals);
    const permittedUnitIds = new Set([
      product.baseUnitId,
      product.saleUnitId ?? product.baseUnitId,
      product.inventoryUnitId ?? product.baseUnitId,
      ...supplierProducts.filter((item) => item.active).map((item) => item.purchaseUnitId),
    ]);
    if (!permittedUnitIds.has(dto.unitId)) {
      throw new Error("La unidad seleccionada no pertenece al producto.");
    }
    const candidateFactors = new Set(
      supplierProducts
        .filter((item) => item.active && item.purchaseUnitId === dto.unitId)
        .map((item) => item.purchaseToBaseFactor),
    );
    if (dto.unitId === product.baseUnitId) candidateFactors.add(1);
    const configuredConversion = conversions.find(
      (item) => item.fromUnitId === dto.unitId && item.toUnitId === product.baseUnitId,
    );
    if (configuredConversion) candidateFactors.add(configuredConversion.factor);
    if (candidateFactors.size !== 1) {
      throw new Error("La presentacion de proveedor es ambigua y no puede usarse para ajustar.");
    }
    const effectiveConversions = [
      {
        fromUnitId: dto.unitId,
        toUnitId: product.baseUnitId,
        factor: [...candidateFactors][0],
      },
    ];
    const canonicalQuantity = toBaseQuantity(dto.quantity, {
      sourceUnitId: dto.unitId,
      baseUnitId: product.baseUnitId,
      conversions: effectiveConversions,
      requireInteger: product.tracking.serial || !baseUnit.allowsDecimals,
    });
    if (!Number.isFinite(canonicalQuantity) || canonicalQuantity > MAX_SAFE_INVENTORY_QUANTITY) {
      throw new Error("La cantidad convertida no puede superar 999,999.99 unidades base.");
    }
    const canonicalDto = { ...dto, quantity: canonicalQuantity };

    // Cantidades SOLO del balance operativo: nunca el agregado de otras ubicaciones.
    const quantityBefore = operational.quantity;
    const quantityAfter = this.getQuantityAfter(canonicalDto, quantityBefore);
    const delta = quantityAfter - quantityBefore;

    this.assertValidDelta(canonicalDto, delta, quantityAfter, operational.availableQuantity);
    if (
      product.tracking.expiration &&
      delta > 0 &&
      dto.expirationDate &&
      isExpirationBeforeOperationDate(dto.expirationDate, getLocalCalendarDate())
    ) {
      throw new Error(EXPIRATION_BEFORE_ENTRY_MESSAGE);
    }

    const adjustmentType = getInventoryAdjustmentType(canonicalDto.movementKind);
    const result = await this.repositories.inventoryAdjustments.registerStockAdjustment({
      tenantId,
      branchId: dto.branchId,
      productId: dto.productId,
      locationId,
      type: adjustmentType,
      reason,
      notes: dto.notes?.trim() || undefined,
      quantityBefore,
      quantityAfter,
      ...(canonicalDto.movementKind === "count" ? { expectedQuantity: quantityBefore } : {}),
      performedByUserId: actorUserId,
      lotId: dto.lotId,
      lotNumber: dto.lotNumber?.trim() || undefined,
      expirationDate: dto.expirationDate,
      serialNumbers: dto.serialNumbers,
    });
    return { adjustmentNumber: result.adjustment.number, movement: result.movements[0] };
  }

  /**
   * Ajuste real: el backend es la autoridad. Se lee la existencia FISICA fresca (onHand) para el
   * delta de conteo y la disponible (sin reservas) como tope de salida.
   */
  private async executeApi(
    dto: AdjustStockDto,
    context: {
      tenantId: string;
      actorUserId: string;
      user: Parameters<typeof ensureUserCanOperateInventoryBranch>[1];
      entitlements: Awaited<ReturnType<typeof ensureTenantCanUseInventory>>;
    },
  ): Promise<RegisterInventoryAdjustmentResult> {
    const { tenantId, actorUserId, user, entitlements } = context;
    const product = await this.repositories.products.getByIdScoped(tenantId, dto.productId);
    if (!product) throw new InventoryServiceError("Producto no encontrado.");
    const businessCapabilities = await this.repositories.businessConfig.getCapabilities(tenantId);
    if (businessCapabilities) {
      ensureTenantCanUseTracking(entitlements, businessCapabilities, product);
    }
    await ensureUserCanOperateInventoryBranch(this.repositories, user, dto.branchId);
    const reason = dto.reason.trim();
    if (!reason) throw new InventoryServiceError("El motivo es requerido.");
    if (reason.length > TEXT_LIMITS.reason) {
      throw new InventoryServiceError("El motivo admite hasta 200 caracteres.");
    }
    // Sin "Multiples ubicaciones" el ajuste va sin ubicacion (el backend admite locationId null).
    // Sin configuracion del negocio el backend interpreta false: no se asume true.
    const usesLocations = businessCapabilities?.supportsMultipleLocations ?? false;
    const operational = await this.resolveOperationalBalance({
      tenantId,
      branchId: dto.branchId,
      productId: dto.productId,
      movementKind: dto.movementKind,
      requestedLocationId: dto.locationId,
      usesLocations,
      fresh: true,
    });
    const locationId = operational.locationId;
    if (dto.unitId !== product.baseUnitId) {
      throw new InventoryServiceError("El ajuste real solo admite la unidad base del producto.");
    }
    const baseUnit = await this.repositories.units.getByIdScoped(tenantId, product.baseUnitId);
    if (!baseUnit) throw new InventoryServiceError("La unidad seleccionada no esta disponible.");
    assertValidInventoryQuantity(dto.quantity, baseUnit.allowsDecimals);

    if (product.productType !== ProductType.physical || !product.tracking.stock) {
      throw new InventoryServiceError("Este producto no controla existencias propias.");
    }
    // /inventory/stock es un AGREGADO de la sucursal: el delta se calcula con el balance real
    // (GET /inventory/balances) de la ubicacion operativa, leido en esta misma operacion.
    const quantityBefore = operational.quantity;
    const quantityAfter = this.getQuantityAfter(dto, quantityBefore);
    const delta = Number((quantityAfter - quantityBefore).toFixed(3));
    if (dto.movementKind !== "count" && dto.quantity <= 0) {
      throw new InventoryServiceError("La cantidad debe ser mayor que cero.");
    }
    if (delta === 0) {
      throw new InventoryServiceError("La existencia ya coincide con el conteo ingresado.");
    }
    if (quantityAfter < 0)
      throw new InventoryServiceError("El ajuste no puede dejar stock negativo.");
    if (delta < 0 && -delta > operational.availableQuantity) {
      throw new InventoryServiceError(
        "La salida no puede superar la existencia disponible (las reservas no se consumen).",
      );
    }

    const required = Math.abs(delta);
    const tracking = product.tracking;
    const serials = dto.serialNumbers ?? [];
    if (tracking.serial) {
      if (!Number.isInteger(required)) {
        throw new InventoryServiceError("Los productos con series requieren una cantidad entera.");
      }
      if (serials.length !== required || new Set(serials).size !== serials.length) {
        throw new InventoryServiceError(`Registra exactamente ${required} series unicas.`);
      }
    }
    if (delta > 0) {
      if (tracking.lot && !dto.lotNumber?.trim())
        throw new InventoryServiceError("Ingresa el lote.");
      if (tracking.expiration) {
        if (!dto.expirationDate)
          throw new InventoryServiceError("Ingresa la fecha de vencimiento.");
        if (isExpirationBeforeOperationDate(dto.expirationDate, getLocalCalendarDate())) {
          throw new InventoryServiceError(EXPIRATION_BEFORE_ENTRY_MESSAGE);
        }
      }
    } else if (tracking.lot && !dto.lotId) {
      throw new InventoryServiceError("Selecciona el lote existente que sale.");
    }

    let result;
    try {
      result = await this.repositories.inventoryAdjustments.registerStockAdjustment({
        tenantId,
        branchId: dto.branchId,
        productId: dto.productId,
        locationId,
        type: getInventoryAdjustmentType(dto.movementKind),
        reason,
        notes: dto.notes?.trim() || undefined,
        quantityBefore,
        quantityAfter,
        ...(dto.movementKind === "count" ? { expectedQuantity: quantityBefore } : {}),
        performedByUserId: actorUserId,
        lotId: delta < 0 ? dto.lotId : undefined,
        lotNumber: delta > 0 ? dto.lotNumber?.trim() || undefined : undefined,
        expirationDate: delta > 0 ? dto.expirationDate : undefined,
        serialNumbers: tracking.serial ? serials : undefined,
      });
    } catch (error) {
      throw toInventoryAdjustmentError(error);
    }
    return { adjustmentNumber: result.adjustment.number, movement: result.movements[0] };
  }

  private getQuantityAfter(dto: AdjustStockDto, quantityBefore: number): number {
    if (dto.movementKind === "count") return dto.quantity;
    if (dto.movementKind === "in") return quantityBefore + dto.quantity;
    return quantityBefore - dto.quantity;
  }

  private assertValidDelta(
    dto: AdjustStockDto,
    delta: number,
    quantityAfter: number,
    availableLocationQuantity: number,
  ): void {
    if (dto.movementKind !== "count" && dto.quantity <= 0) {
      throw new Error("La cantidad debe ser mayor que cero.");
    }
    if (quantityAfter < 0) {
      throw new Error("El ajuste no puede dejar stock negativo.");
    }
    if (
      (dto.movementKind === "out" || dto.movementKind === "waste") &&
      dto.quantity > availableLocationQuantity
    ) {
      throw new Error("La salida no puede dejar stock negativo en la ubicacion seleccionada.");
    }
    if (dto.movementKind === "count" && delta === 0) {
      throw new Error("El conteo coincide con el stock actual; no se genero ajuste.");
    }
    if (dto.movementKind === "count" && Math.abs(delta) > availableLocationQuantity && delta < 0) {
      throw new Error(
        "La correccion no puede descontar mas stock del disponible en la ubicacion seleccionada.",
      );
    }
  }

  /**
   * Balance REAL sobre el que opera el ajuste (nunca el agregado de la sucursal). Lee los balances
   * por ubicacion del producto y aplica la misma politica que el backend.
   */
  async resolveOperationalBalance(input: {
    tenantId: string;
    branchId: string;
    productId: string;
    movementKind: AdjustStockDto["movementKind"];
    requestedLocationId?: string;
    usesLocations: boolean;
    /** Referencia ya validada por la pantalla; solo para lectura previa, nunca para confirmar. */
    knownLocations?: StorageLocation[];
    /** Las confirmaciones omiten cache y vuelven a validar saldo y ubicaciones. */
    fresh?: boolean;
  }): Promise<OperationalAdjustmentBalance> {
    const [settings, locations, balances] = await Promise.all([
      input.usesLocations
        ? this.repositories.inventory.getProductInventorySettings(input.productId, input.branchId)
        : Promise.resolve(null),
      input.usesLocations
        ? !input.fresh && input.knownLocations
          ? Promise.resolve(
              input.knownLocations.filter(
                (location) =>
                  location.tenantId === input.tenantId && location.branchId === input.branchId,
              ),
            )
          : this.repositories.inventory.getLocations(input.branchId)
        : Promise.resolve([]),
      this.repositories.inventory.getProductBalances(
        input.productId,
        input.branchId,
        input.tenantId,
        input.fresh ? { fresh: true } : undefined,
      ),
    ]);
    const operational = selectOperationalAdjustmentBalance({
      ...input,
      settings,
      locations,
      balances,
    });
    assertAdjustmentTargetIsUnambiguous(input.movementKind, operational);
    return operational;
  }
}

const ADJUSTMENT_ERROR_MESSAGES: Record<string, string> = {
  COUNT_SNAPSHOT_STALE:
    "La existencia cambio mientras realizabas el conteo. Actualiza los datos antes de aplicarlo.",
  INSUFFICIENT_STOCK:
    "La salida supera la existencia disponible; las unidades reservadas no pueden ajustarse.",
  INVENTORY_ASSIGNED_LOCATION_INACTIVE:
    "La ubicacion operativa asignada esta inactiva. Asigna una ubicacion activa.",
  INVENTORY_ASSIGNED_LOCATION_INVALID:
    "La ubicacion operativa asignada no existe o no pertenece a la sucursal.",
  INVENTORY_LOCATION_MISMATCH:
    "El ajuste no corresponde a la ubicacion operativa actual del producto.",
  INVENTORY_LOCATION_CONFLICT:
    "El producto conserva existencias en otra ubicacion. Regulariza el inventario antes de continuar.",
};

export function toInventoryAdjustmentError(error: unknown): Error {
  if (error instanceof BackendRequestError && error.code) {
    const message = ADJUSTMENT_ERROR_MESSAGES[error.code];
    if (message) return new InventoryServiceError(message);
  }
  return error instanceof Error
    ? error
    : new InventoryServiceError("No se pudo registrar el ajuste.");
}

export interface OperationalAdjustmentBalance {
  /** undefined = balance sin ubicacion (NULL), distinto de una cantidad nula. */
  locationId: string | undefined;
  quantity: number;
  availableQuantity: number;
  /** true si el producto conserva existencias o reservas en OTROS balances de la sucursal. */
  hasStockElsewhere: boolean;
}

export const STOCK_ELSEWHERE_ADJUSTMENT_MESSAGE =
  "El producto conserva existencias en otra ubicacion de la sucursal. Solo se permiten salidas hasta " +
  "regularizar el inventario: las entradas y los conteos no pueden determinar el saldo sin ambiguedad.";

/**
 * Politica del backend (InventoryOperationalLocationService):
 * - Control de ubicaciones apagado o capacidad ausente: el ajuste va sin ubicacion (balance NULL).
 * - Encendido con ubicacion asignada: el unico balance operativo es el de esa ubicacion.
 * - Encendido sin asignacion: solo se opera el balance NULL historico si existe; nunca se inventa una
 *   ubicacion ni se usa la primera de la lista.
 * Cantidades y reservas salen SOLO del balance elegido.
 */
export function selectOperationalAdjustmentBalance(input: {
  tenantId: string;
  branchId: string;
  productId: string;
  requestedLocationId?: string;
  usesLocations: boolean;
  settings: ProductInventorySettings | null;
  locations: StorageLocation[];
  balances: InventoryBalance[];
}): OperationalAdjustmentBalance {
  const scoped = input.balances.filter(
    (balance) =>
      balance.tenantId === input.tenantId &&
      balance.branchId === input.branchId &&
      balance.productId === input.productId,
  );
  const locationId = resolveOperationalInventoryLocation({
    ...input,
    legacyNullBalance: scoped.some((balance) => !balance.locationId),
  });
  const target = scoped.find((balance) => (balance.locationId ?? null) === (locationId ?? null));
  const quantity = target?.quantity ?? 0;
  return {
    locationId,
    quantity,
    availableQuantity: Math.max(0, quantity - (target?.reservedQuantity ?? 0)),
    hasStockElsewhere: scoped.some(
      (balance) => balance !== target && (balance.quantity > 0 || balance.reservedQuantity > 0),
    ),
  };
}

export function assertAdjustmentTargetIsUnambiguous(
  movementKind: AdjustStockDto["movementKind"],
  operational: Pick<OperationalAdjustmentBalance, "hasStockElsewhere">,
) {
  if (operational.hasStockElsewhere && (movementKind === "in" || movementKind === "count")) {
    throw new InventoryServiceError(STOCK_ELSEWHERE_ADJUSTMENT_MESSAGE);
  }
}

export function resolveOperationalInventoryLocation(input: {
  tenantId: string;
  branchId: string;
  productId: string;
  requestedLocationId?: string;
  usesLocations: boolean;
  settings: ProductInventorySettings | null;
  locations: StorageLocation[];
  /** Existe un balance NULL historico: un producto sin asignacion puede seguir operandolo. */
  legacyNullBalance?: boolean;
}): string | undefined {
  if (!input.usesLocations) return undefined;
  const settings = input.settings;
  const locationId = settings?.defaultLocationId;
  const hasAssignment =
    !!settings &&
    settings.tenantId === input.tenantId &&
    settings.branchId === input.branchId &&
    settings.productId === input.productId &&
    !!locationId;
  if (!hasAssignment && input.legacyNullBalance && !input.requestedLocationId) {
    return undefined;
  }
  if (!settings || !locationId || !hasAssignment) {
    throw new InventoryServiceError(
      "Configura una ubicacion operativa activa para este producto y sucursal.",
    );
  }
  const location = input.locations.find((candidate) => candidate.id === locationId);
  if (
    !location ||
    location.tenantId !== input.tenantId ||
    location.branchId !== input.branchId ||
    location.status !== LocationStatus.active
  ) {
    throw new InventoryServiceError(
      "La ubicacion operativa del producto no esta activa o no pertenece a esta sucursal.",
    );
  }
  if (input.requestedLocationId && input.requestedLocationId !== locationId) {
    throw new InventoryServiceError(
      "El ajuste solo puede aplicarse en la ubicacion operativa configurada para el producto.",
    );
  }
  return locationId;
}

export function assertValidInventoryQuantity(quantity: number, unitAllowsDecimals: boolean) {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new InventoryServiceError("Ingresa una cantidad valida.");
  }
  if (quantity > MAX_SAFE_INVENTORY_QUANTITY) {
    throw new InventoryServiceError("La cantidad no puede superar 999,999.99.");
  }
  if (!isQuantityCompatibleWithUnit(quantity, unitAllowsDecimals)) {
    throw new InventoryServiceError(
      unitAllowsDecimals
        ? "La cantidad admite hasta 3 decimales."
        : "La unidad seleccionada no admite fracciones.",
    );
  }
}

function getInventoryAdjustmentType(
  movementKind: AdjustStockDto["movementKind"],
): InventoryAdjustmentType {
  if (movementKind === "in") return InventoryAdjustmentType.manualIncrease;
  if (movementKind === "out") return InventoryAdjustmentType.manualDecrease;
  if (movementKind === "waste") return InventoryAdjustmentType.waste;
  return InventoryAdjustmentType.countCorrection;
}

/** Lookups bajo demanda del modal de ajuste (modo API); sin N+1 en el listado. */
export class InventoryAdjustmentLookupService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  /** Resuelve el tracking REAL del producto solo cuando el usuario abre "Ajustar existencias". */
  async resolveTracking(productId: string): Promise<InventoryProductRow["tracking"]> {
    const { tenantId, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanCreateAdjustment(permissions);
    const product = await this.repositories.products.getByIdScoped(tenantId, productId);
    if (!product) throw new InventoryServiceError("Producto no encontrado.");
    return product.tracking;
  }

  /**
   * Balance operativo REAL del producto (modo API: GET /inventory/balances), para mostrar en el modal
   * las cantidades ajustables sin usar el agregado de /inventory/stock. Nunca bloquea por ambiguedad:
   * eso lo decide el envio segun el tipo de ajuste.
   */
  async resolveOperationalStock(input: {
    branchId: string;
    productId: string;
    usesLocations: boolean;
    knownLocations?: StorageLocation[];
  }): Promise<OperationalAdjustmentBalance> {
    const { tenantId, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanCreateAdjustment(permissions);
    return new RegisterInventoryAdjustmentService(this.repositories).resolveOperationalBalance({
      tenantId,
      branchId: input.branchId,
      productId: input.productId,
      movementKind: "out",
      usesLocations: input.usesLocations,
      knownLocations: input.knownLocations,
    });
  }

  async listLots(input: {
    branchId: string;
    productId: string;
    locationId?: string;
  }): Promise<AdjustmentLotOption[]> {
    await this.ensureAllowed();
    return this.repositories.inventoryAdjustments.listAvailableLots(input);
  }

  async listSerials(input: {
    branchId: string;
    productId: string;
    locationId?: string;
    lotId?: string;
  }): Promise<AdjustmentSerialOption[]> {
    await this.ensureAllowed();
    return this.repositories.inventoryAdjustments.listAvailableSerials(input);
  }

  async validateNewSerials(input: {
    productId: string;
    serialNumbers: string[];
  }): Promise<SerialValidationResult> {
    await this.ensureAllowed();
    return this.repositories.inventoryAdjustments.validateNewSerials(input);
  }

  private async ensureAllowed() {
    const { permissions } = await resolveInventoryContext(this.repositories);
    ensureCanCreateAdjustment(permissions);
  }
}
