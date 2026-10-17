import { PurchaseOrderStatus } from "@/core/enums";
import type { PurchaseOrderAction } from "@/modules/purchasing/application/dto/PurchaseOrderReadModel";

const CREATE_PERMISSION = "purchasing.orders.create";
const APPROVE_PERMISSION = "purchasing.orders.approve";

/**
 * Unica fuente de las acciones/transiciones validas de una orden -- consumida por el read model
 * (decide que botones mostrar/habilitar en la tabla) Y por `UpdatePurchaseOrderStatusService`
 * (valida que un `statusTarget` sea una transicion real desde el status actual).
 *
 * `enabled` ahora combina DOS señales obligatorias (permission-hardening PR #98, hallazgo
 * IMPORTANT #3): STATE ALLOWS (la accion solo existe para los status donde tiene sentido, igual
 * que antes) AND PERMISSION ALLOWS (`permissions` resueltos por sesion via
 * `resolvePurchasingContext` -- NUNCA enviados desde la UI/DTO). Antes de este fix, `enabled`
 * era `true` incondicional para toda accion cuyo status coincidiera, sin mirar el permiso del
 * actor -- un rol read-only veia "Aprobar" habilitado en la UI aunque el backend
 * (`UpdatePurchaseOrderStatusService`) lo fuera a rechazar igual.
 *
 * Este calculo es SOLO para la UI (ocultar/deshabilitar botones que el backend rechazaria) --
 * el guard real en `UpdatePurchaseOrderStatusService`/`PurchaseOrderEditorService` sigue siendo
 * obligatorio e independiente, nunca se sustituye por este gating.
 *
 * Mapeo de permiso por accion: editar/enviar a aprobacion/cancelar un DRAFT propio usa
 * `purchasing.orders.create` (ciclo de vida del propio borrador); aprobar, o cancelar una orden
 * que ya salio de borrador, usa `purchasing.orders.approve` (decision sobre el flujo formal).
 * Las acciones de solo lectura (continuar/iniciar recepcion, descargar PDF) no exigen ningun
 * permiso adicional mas alla de haber llegado al read model -- eso ya lo garantiza
 * `ensureCanReadPurchaseOrders` (que acepta read/create/approve) en
 * `GetPurchaseOrdersReadModelService`.
 */
export function getPurchaseOrderActions(
  status: PurchaseOrderStatus,
  permissions: readonly string[],
): PurchaseOrderAction[] {
  const canCreate = permissions.includes(CREATE_PERMISSION);
  const canApprove = permissions.includes(APPROVE_PERMISSION);

  if (status === PurchaseOrderStatus.draft) {
    return [
      withPermission({ id: "edit-draft", label: "Editar" }, canCreate),
      withPermission(
        {
          id: "send-approval",
          label: "Crear orden",
          statusTarget: PurchaseOrderStatus.pending_approval,
        },
        canCreate,
      ),
      withPermission(
        { id: "cancel", label: "Cancelar", statusTarget: PurchaseOrderStatus.cancelled },
        canCreate,
      ),
    ];
  }

  if (status === PurchaseOrderStatus.pending_approval) {
    return [
      withPermission(
        { id: "approve", label: "Aprobar", statusTarget: PurchaseOrderStatus.approved },
        canApprove,
      ),
      withPermission(
        { id: "cancel", label: "Cancelar", statusTarget: PurchaseOrderStatus.cancelled },
        canApprove,
      ),
    ];
  }

  if (status === PurchaseOrderStatus.partially_received) {
    return [
      { id: "continue-receiving", label: "Continuar recepcion", enabled: true },
      { id: "download-receiving-pdf", label: "Descargar estado de recepcion", enabled: true },
    ];
  }

  if (status === PurchaseOrderStatus.received) {
    return [
      { id: "download-purchase-order-pdf", label: "Descargar orden original", enabled: true },
      { id: "download-receiving-pdf", label: "Descargar recepcion final", enabled: true },
    ];
  }
  if (status === PurchaseOrderStatus.cancelled) return [];

  if (status === PurchaseOrderStatus.approved) {
    return [
      { id: "continue-receiving", label: "Iniciar recepcion", enabled: true },
      withPermission(
        { id: "cancel", label: "Cancelar", statusTarget: PurchaseOrderStatus.cancelled },
        canApprove,
      ),
      { id: "download-purchase-order-pdf", label: "Descargar orden de compra", enabled: true },
    ];
  }

  if (status === PurchaseOrderStatus.sent) {
    return [
      { id: "continue-receiving", label: "Iniciar recepcion", enabled: true },
      { id: "download-purchase-order-pdf", label: "Descargar orden de compra", enabled: true },
    ];
  }

  return [];
}

function withPermission(
  action: Omit<PurchaseOrderAction, "enabled" | "unavailableReason">,
  permissionAllows: boolean,
): PurchaseOrderAction {
  return {
    ...action,
    enabled: permissionAllows,
    ...(permissionAllows
      ? {}
      : { unavailableReason: "No dispone del permiso necesario para esta acción." }),
  };
}
