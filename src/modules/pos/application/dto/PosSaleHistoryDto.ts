import type { SaleDocumentType } from "@/core/entities";
import type { DeliveryMethod, OrderStatus, PaymentMethod, SaleStatus } from "@/core/enums";
import type { CurrencyCode } from "@/core/types/common.types";

export type PosSaleHistoryTone = "neutral" | "info" | "success" | "warning" | "danger";
export type PosSaleHistoryDeliveryFilter = "all" | "unavailable" | DeliveryMethod;
export type PosSaleHistoryOperationalFilter =
  "all" | "immediate" | "unavailable" | OrderStatus;

export interface PosSaleHistoryFilters {
  search: string;
  dateFrom: string;
  dateTo: string;
  deliveryMethod: PosSaleHistoryDeliveryFilter;
  saleStatus: "all" | SaleStatus;
  operationalStatus: PosSaleHistoryOperationalFilter;
}

export interface PosSaleHistoryItemDto {
  saleId: string;
  documentNumber: string;
  documentType: SaleDocumentType;
  taxId?: string;
  createdAt: string;
  customerDisplayName: string;
  total: number;
  saleStatus: SaleStatus;
  saleStatusLabel: string;
  saleStatusTone: PosSaleHistoryTone;
  deliveryMethod?: DeliveryMethod;
  deliveryMethodLabel: string;
  sourceOrderId?: string;
  orderNumber?: string;
  orderStatus?: OrderStatus;
  operationalStatusLabel: string;
  operationalStatusTone: PosSaleHistoryTone;
  hasUnavailableOrder: boolean;
  paymentSummary: string;
  payments: Array<{
    paymentId: string;
    method: PaymentMethod;
    methodLabel: string;
    amount: number;
    currency: CurrencyCode;
  }>;
  items: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    subtotal: number;
  }>;
}

export interface PosSaleHistorySummaryDto {
  total: number;
  active: number;
  partiallyReturned: number;
  returned: number;
  cancelled: number;
}

/** Campos que en modo API solo trae el detalle de la venta (`GET /pos/sales/{id}`). */
export type PosSaleHistoryDetailField = "documentType" | "taxId" | "paymentSummary" | "payments" | "items";

/**
 * Fila del listado. En modo mock llega completa; en modo API los campos de detalle se cargan al
 * seleccionar la venta, para no pedir un detalle por cada fila del historial.
 */
export type PosSaleHistoryRowDto = Omit<PosSaleHistoryItemDto, PosSaleHistoryDetailField> &
  Partial<Pick<PosSaleHistoryItemDto, PosSaleHistoryDetailField>>;

export function isPosSaleHistoryDetailLoaded(
  sale: PosSaleHistoryRowDto,
): sale is PosSaleHistoryItemDto {
  return (
    sale.documentType !== undefined &&
    sale.paymentSummary !== undefined &&
    sale.payments !== undefined &&
    sale.items !== undefined
  );
}

export const POS_SALE_HISTORY_DEFAULT_PAGE_SIZE = 10;

/** Una página del historial. En modo API la página, el total y el resumen los da el backend. */
export interface PosSaleHistoryDto {
  sales: PosSaleHistoryRowDto[];
  summary: PosSaleHistorySummaryDto;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export const defaultPosSaleHistoryFilters: PosSaleHistoryFilters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  deliveryMethod: "all",
  saleStatus: "all",
  operationalStatus: "all",
};
