import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";
import type { SaleTicketItemDto } from "@/modules/pos/application/dto/SaleTicketDto";

interface TicketQuantitySource {
  availableQuantity: PosProductDto["availableQuantity"] | SaleTicketItemDto["availableQuantity"];
  name: string;
  tracksStock: boolean;
  isAvailableForSale?: boolean;
  requiresUnsupportedTraceability?: boolean;
}

export function validateTicketQuantity(
  product: TicketQuantitySource,
  requestedQuantity: number,
): string | null {
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) {
    return "La cantidad debe ser un número entero mayor que cero.";
  }

  if (product.isAvailableForSale === false && !product.requiresUnsupportedTraceability) {
    return `${product.name} no está disponible para la venta.`;
  }

  if (!product.tracksStock) return null;

  const availableQuantity = product.availableQuantity ?? 0;
  if (availableQuantity <= 0) {
    return `${product.name} no tiene existencia disponible en la sucursal activa.`;
  }

  if (requestedQuantity > availableQuantity) {
    return `No puedes agregar más de ${availableQuantity} ${"saleUnitName" in product ? product.saleUnitName : "unidades"} de ${product.name}.`;
  }

  return null;
}
