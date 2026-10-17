import type { ReturnSaleItemDto } from "@/modules/pos/application/dto/ReturnSaleLookupDto";

export interface ReturnSelectionValidation {
  isValid: boolean;
  reasonError?: string;
  lineErrors: Record<string, string>;
  lines: Array<{ saleItemId: string; quantity: number }>;
}

export function validateReturnSelection(
  reason: string,
  quantities: Record<string, string>,
  items: ReturnSaleItemDto[],
): ReturnSelectionValidation {
  const reasonError = reason.trim() ? undefined : "El motivo de la devolución es obligatorio.";
  const lineErrors: Record<string, string> = {};
  const lines: Array<{ saleItemId: string; quantity: number }> = [];

  items.forEach((item) => {
    const rawQuantity = quantities[item.saleItemId]?.trim() ?? "";
    if (!rawQuantity) return;

    const quantity = Number(rawQuantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      lineErrors[item.saleItemId] = "Ingresa una cantidad válida.";
      return;
    }
    if (quantity === 0) return;
    if (!item.canReturn || quantity > item.returnableQuantity) {
      lineErrors[item.saleItemId] = `La cantidad máxima retornable es ${item.returnableQuantity}.`;
      return;
    }
    lines.push({ saleItemId: item.saleItemId, quantity });
  });

  return {
    isValid: !reasonError && Object.keys(lineErrors).length === 0 && lines.length > 0,
    reasonError,
    lineErrors,
    lines,
  };
}

export function validateVoidReason(reason: string) {
  const reasonError = reason.trim() ? undefined : "El motivo de la anulación es obligatorio.";
  return { isValid: !reasonError, reasonError };
}
