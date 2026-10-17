import {
  InventoryMovementType,
  PaymentMethod,
  PaymentStatus,
  PurchaseOrderStatus,
  SaleStatus,
} from "@/core/enums";

const statusLabels: Record<string, string> = {
  [SaleStatus.completed]: "Completada",
  [SaleStatus.partially_returned]: "Parcialmente devuelta",
  [SaleStatus.returned]: "Devuelta",
  [SaleStatus.cancelled]: "Cancelada",
  [PurchaseOrderStatus.draft]: "Borrador",
  [PurchaseOrderStatus.pending_approval]: "Pendiente de aprobación",
  [PurchaseOrderStatus.approved]: "Aprobada",
  [PurchaseOrderStatus.sent]: "Enviada",
  [PurchaseOrderStatus.partially_received]: "Recibida parcialmente",
  [PurchaseOrderStatus.received]: "Recibida",
  [PaymentStatus.pending]: "Pendiente",
  [PaymentStatus.rejected]: "Rechazado",
  [PaymentStatus.refunded]: "Reembolsado",
};

const movementTypeLabels: Record<string, string> = {
  [InventoryMovementType.in]: "Entrada",
  [InventoryMovementType.out]: "Salida",
  [InventoryMovementType.adjustment]: "Ajuste",
  [InventoryMovementType.transfer]: "Transferencia",
};

const paymentMethodLabels: Record<string, string> = {
  [PaymentMethod.cash]: "Efectivo",
  [PaymentMethod.card]: "Tarjeta",
  [PaymentMethod.transfer]: "Transferencia",
  [PaymentMethod.mixed]: "Mixto",
};

export function getReportStatusLabel(status: string) {
  return statusLabels[status] ?? status;
}

export function getMovementTypeLabel(type: string) {
  return movementTypeLabels[type] ?? type;
}

export function getPaymentMethodLabel(method: string) {
  return paymentMethodLabels[method] ?? method;
}
