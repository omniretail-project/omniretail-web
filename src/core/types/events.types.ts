export type DataEventName =
  | "auth.changed"
  | "user.changed"
  // PR13: deliberadamente SEPARADO de "auth.changed" -- ese evento lo
  // escucha CurrentSessionProvider para recargar user/role, y hace que
  // RequireSession muestre "Cargando sesion..." mientras tanto (unmount
  // temporal del subarbol autenticado). Activar/desactivar/verificar MFA
  // no cambia identidad ni permisos, asi que emitir auth.changed ahi
  // remontaria toda la pantalla de Seguridad a mitad de un wizard
  // (perdiendo el paso actual, ej. el modal de recovery codes) sin
  // necesidad real.
  | "mfa.changed"
  | "branch.changed"
  | "role.changed"
  | "business-config.changed"
  | "email-sender.changed"
  // Cambio de Plan del Tenant (feature/tenant-plan-selection) -- SEPARADO de
  // "business-config.changed": ese evento cubre la CONFIG OPERATIVA del negocio
  // (BusinessCapabilitiesConfig/EcommerceConfig) y este el DERECHO COMERCIAL
  // (plan.capabilities). No son la misma capa y un downgrade de Plan nunca muta
  // BusinessConfig, asi que fusionarlos haria recargar la capa equivocada.
  | "tenant-subscription.changed"
  | "product.changed"
  | "product-price.changed"
  | "product-sales-price-tier.changed"
  | "category.changed"
  | "promotion.changed"
  | "unit-conversion.changed"
  | "inventory.changed"
  | "inventory-adjustment.changed"
  | "inventory-transfer.changed"
  | "inventory-transfer-request.changed"
  | "stock.changed"
  | "supplier.changed"
  | "supplier-product.changed"
  | "purchase-order.changed"
  | "receipt.changed"
  | "incident-type.changed"
  | "customer.changed"
  | "customer-payment-method.changed"
  | "address.changed"
  | "order.changed"
  | "payment.changed"
  | "sale.changed"
  | "sale.returned"
  | "sale.voided"
  | "cash-shift.changed"
  | "picking.changed"
  | "packing.changed"
  | "dispatch.changed"
  | "notification.changed"
  | "audit.changed";

export interface DataEventPayload {
  entityId?: string;
  tenantId?: string;
  branchId?: string;
  productId?: string;
  pickingOrderId?: string;
  pickingLineId?: string;
  packingId?: string;
  orderId?: string;
  incidentId?: string;
  previousPrice?: number;
  newPrice?: number;
  action?:
    | "created"
    | "updated"
    | "archived"
    | "restored"
    | "deleted"
    | "status_changed"
    | "reset";
  metadata?: Record<string, unknown>;
}

export interface PickingChangedEventPayload extends DataEventPayload {
  tenantId: string;
  branchId: string;
  pickingOrderId: string;
  orderId?: string;
  sourceType?: "order" | "transfer";
  sourceId?: string;
}

export interface PackingChangedEventPayload extends DataEventPayload {
  tenantId: string;
  branchId: string;
  packingId: string;
  orderId?: string;
  sourceType?: "order" | "transfer";
  sourceId?: string;
}

export interface DataEventPayloadMap {
  "picking.changed": PickingChangedEventPayload;
  "packing.changed": PackingChangedEventPayload;
}

export type DataEventPayloadFor<EventName extends DataEventName> =
  EventName extends keyof DataEventPayloadMap ? DataEventPayloadMap[EventName] : DataEventPayload;

export type DataEventArguments<EventName extends DataEventName> =
  EventName extends keyof DataEventPayloadMap
    ? [payload: DataEventPayloadFor<EventName>]
    : [payload?: DataEventPayloadFor<EventName>];
