import type { SaleTicketItemDto } from "@/modules/pos/application/dto/SaleTicketDto";
import { normalizePosTrackingQuantity } from "@/modules/pos/application/posTrackingSelection";

/**
 * Revalida la selección persistida sin reconstruirla ni canonicalizarla. Esto conserva exactamente
 * el payload de una venta pendiente y deja al backend como autoridad final sobre el inventario.
 * Las ventas diferidas pueden omitir la selección porque Picking resolverá el inventario físico;
 * cualquier selección ya presente continúa validándose y nunca se acepta parcialmente.
 */
export function validateSaleTicketTraceability(
  items: SaleTicketItemDto[],
  options: { requirePhysicalSelection?: boolean } = {},
): void {
  const requirePhysicalSelection = options.requirePhysicalSelection ?? true;
  const ticketSerials = new Set<string>();

  for (const item of items) {
    validateItemTraceability(item, ticketSerials, requirePhysicalSelection);
  }
}

function validateItemTraceability(
  item: SaleTicketItemDto,
  ticketSerials: Set<string>,
  requirePhysicalSelection: boolean,
): void {
  const selections = item.trackingSelections ?? [];

  if (item.requiresUnsupportedTraceability) {
    throw new Error(`${item.name} requiere trazabilidad no soportada en Terminal.`);
  }

  if (!item.requiresTraceabilitySelection) {
    if (selections.length > 0) {
      throw new Error(`La selección física de ${item.name} no corresponde a una línea trazable.`);
    }
    return;
  }

  if (item.isKit) {
    throw new Error(`${item.name} es un kit con trazabilidad no soportada en Terminal.`);
  }
  if (!requirePhysicalSelection && selections.length === 0) {
    return;
  }
  if (selections.length === 0) {
    throw new Error(`Debe completar la selección física de ${item.name}.`);
  }
  if (!item.baseUnitId?.trim()) {
    throw new Error(`No se pudo determinar la unidad base de ${item.name}.`);
  }
  if (item.requiresExpiration && !item.requiresLot) {
    throw new Error(`${item.name} requiere vencimiento sin un lote compatible.`);
  }

  const requiredBaseQuantity = normalizePosTrackingQuantity(item.baseQuantity ?? Number.NaN);
  const convertedBaseQuantity = normalizePosTrackingQuantity(
    item.quantity * (item.saleUnitToBaseFactor ?? Number.NaN),
  );
  if (convertedBaseQuantity !== requiredBaseQuantity) {
    throw new Error(`La conversión a unidades base de ${item.name} ya no es consistente.`);
  }
  if (item.requiresSerial && !Number.isInteger(requiredBaseQuantity)) {
    throw new Error(`La cantidad serializada de ${item.name} debe ser entera.`);
  }

  const selectionKeys = new Set<string>();
  let selectedBaseQuantity = 0;
  for (const selection of selections) {
    if (selection.productId !== item.productId) {
      throw new Error(`La selección física de ${item.name} pertenece a otro producto.`);
    }
    if (!selection.locationId.trim()) {
      throw new Error(`La selección física de ${item.name} no tiene una ubicación válida.`);
    }
    const lotId = selection.lotId?.trim() || null;
    if (item.requiresLot ? !lotId : Boolean(lotId)) {
      throw new Error(`La selección física de ${item.name} no cumple su control de lotes.`);
    }

    // El backend admite una sola entrada por lote; sin lotes, una sola por ubicación.
    const key = item.requiresLot ? lotId! : selection.locationId;
    if (selectionKeys.has(key)) {
      throw new Error(`La selección física de ${item.name} repite un lote o ubicación.`);
    }
    selectionKeys.add(key);

    const quantity = normalizePosTrackingQuantity(selection.quantity);
    selectedBaseQuantity += quantity;
    const serials = selection.serialNumbers ?? [];
    if (item.requiresSerial) {
      if (!Number.isInteger(quantity) || serials.length !== quantity) {
        throw new Error(`Las series seleccionadas de ${item.name} no cubren la cantidad requerida.`);
      }
      for (const serial of serials) {
        const normalizedSerial = serial.trim().toLocaleUpperCase("es");
        if (!normalizedSerial) {
          throw new Error(`La selección física de ${item.name} contiene una serie vacía.`);
        }
        if (ticketSerials.has(normalizedSerial)) {
          throw new Error(`La serie ${serial.trim()} está duplicada en el ticket.`);
        }
        ticketSerials.add(normalizedSerial);
      }
    } else if (serials.length > 0) {
      throw new Error(`${item.name} no requiere números de serie.`);
    }
  }

  if (normalizePosTrackingQuantity(selectedBaseQuantity) !== requiredBaseQuantity) {
    throw new Error(
      `La selección física de ${item.name} no cubre exactamente la cantidad en unidades base.`,
    );
  }
}
