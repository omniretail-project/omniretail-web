import type { Branch, PurchaseOrder, User } from "@/core/entities";
import { SaasCapabilityKey } from "@/core/enums";
import { canUserOperateBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import { ensureTenantCapability } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

export class PurchasingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchasingServiceError";
  }
}

export interface PurchasingSessionContext {
  tenantId: string;
  actorUserId: string;
  user: User;
  permissions: readonly string[];
}

/**
 * Unica fuente de tenant/actor/permisos para Purchasing -- permission-hardening
 * (feature/permission-hardening-purchasing-receiving). Antes de este fix, `tenantId` llegaba
 * como parametro explicito desde el hook (`usePurchaseOrderEditor`, derivado de
 * `ActiveBranchProvider`) y los services confiaban en el sin volver a resolverlo: una llamada
 * directa al service (bypass de la UI) con un `tenantId` de OTRO tenant pasaba todas las
 * validaciones existentes, porque esas validaciones solo comprobaban que
 * proveedor/sucursal/productos pertenecieran al `tenantId` QUE EL LLAMADOR ELIGIO, nunca al
 * tenant real de la sesion. Ahora el tenant SIEMPRE sale de `resolveCurrentSessionSnapshot`, no
 * de ningun parametro ni DTO.
 */
export async function resolvePurchasingContext(
  repositories: RepositoryRegistry,
): Promise<PurchasingSessionContext> {
  const snapshot = await resolveCurrentSessionSnapshot(repositories);
  if (!snapshot.user || !snapshot.role) {
    throw new PurchasingServiceError("No se pudo resolver el negocio activo.");
  }
  return {
    tenantId: snapshot.user.tenantId,
    actorUserId: snapshot.user.id,
    user: snapshot.user,
    permissions: snapshot.role.permissions,
  };
}

/**
 * `.create`/`.approve` implican poder leer -- mismo criterio que Categorias/Ubicaciones/Unidades
 * (#94) y Products (#95): quien puede crear o aprobar ordenes necesariamente puede consultarlas.
 */
export function ensureCanReadPurchaseOrders(permissions: readonly string[]) {
  if (
    permissions.includes("purchasing.orders.read") ||
    permissions.includes("purchasing.orders.create") ||
    permissions.includes("purchasing.orders.approve")
  ) {
    return;
  }
  throw new PurchasingServiceError("No dispone de permisos para consultar órdenes de compra.");
}

/**
 * Cubre crear, guardar borrador y enviar a aprobacion (draft -> pending_approval) -- todas
 * acciones sobre el CICLO DE VIDA DEL BORRADOR de una orden, que el propio creador controla. No
 * existe una key `purchasing.orders.update` en el catalogo canonico; el ticket pide no inventar
 * una salvo necesidad real, y esta accion ya esta cubierta semanticamente por "crear ordenes".
 */
export function ensureCanCreatePurchaseOrders(permissions: readonly string[]) {
  if (permissions.includes("purchasing.orders.create")) return;
  throw new PurchasingServiceError("No dispone de permisos para crear órdenes de compra.");
}

/**
 * Cubre aprobar Y cancelar una orden que YA salio del estado borrador (pending_approval/
 * approved/sent) -- son decisiones de aprobacion/rechazo sobre el flujo formal, no del creador
 * original. Cancelar un DRAFT propio, en cambio, usa `ensureCanCreatePurchaseOrders` (ver
 * UpdatePurchaseOrderStatusService): distinguir por el estado ORIGEN de la transicion, no por la
 * accion en si, es lo que permite representar "cancelar" con las 2 keys existentes sin inventar
 * una tercera.
 */
export function ensureCanApprovePurchaseOrders(permissions: readonly string[]) {
  if (permissions.includes("purchasing.orders.approve")) return;
  throw new PurchasingServiceError("No dispone de permisos para aprobar órdenes de compra.");
}

/**
 * El id de la orden llega desde la URL/estado del cliente: una orden de otro tenant se trata
 * igual que una inexistente, mismo mensaje, para no confirmar su existencia (mismo criterio que
 * `ensureRoleBelongsToTenant`/`ensureBranchBelongsToTenant` en administration).
 */
export function ensurePurchaseOrderBelongsToTenant(
  order: PurchaseOrder | null,
  tenantId: string,
): PurchaseOrder {
  if (order?.tenantId === tenantId) return order;
  throw new PurchasingServiceError("Orden de compra no encontrada.");
}

/**
 * Validacion de sucursal contra `User.allowedBranchIds` (fuente autoritativa desde #94), NUNCA
 * contra `Role.branchScope` -- Purchasing no tenia NINGUNA validacion de sucursal antes de este
 * fix; el branchId elegido en el formulario nunca se contrastaba contra lo que el empleado
 * realmente tiene asignado, solo contra el tenant.
 */
export async function ensureUserCanOperateBranch(
  repositories: RepositoryRegistry,
  user: User,
  branchId: string,
): Promise<Branch> {
  const branch = await repositories.branches.getById(branchId);
  if (!branch || branch.tenantId !== user.tenantId) {
    throw new PurchasingServiceError(
      "La sucursal seleccionada no está disponible para este negocio.",
    );
  }
  if (!canUserOperateBranch(user, branch)) {
    throw new PurchasingServiceError("No dispone de acceso a la sucursal seleccionada.");
  }
  return branch;
}

export function cleanError(error: unknown): string {
  if (error instanceof PurchasingServiceError) return error.message;
  if (error instanceof Error) return error.message;
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

/**
 * Capa de entitlement SaaS (feature/saas-entitlement-enforcement, auditoría §12) -- se suma a
 * `ensureCanCreatePurchaseOrders`/`ensureCanApprovePurchaseOrders`, nunca los sustituye. Solo
 * gatea mutaciones (crear/guardar borrador/enviar a aprobación/aprobar/cancelar); el read model
 * histórico (`GetPurchaseOrdersReadModelService`) sigue gobernado únicamente por
 * `ensureCanReadPurchaseOrders` (auditoría §10/§12: preservar lectura histórica).
 */
export async function ensureTenantCanUsePurchasing(
  repositories: RepositoryRegistry,
  tenantId: string,
): Promise<void> {
  const entitlements = await new ResolveTenantEntitlementsService(repositories).execute(tenantId);
  ensureTenantCapability(entitlements, SaasCapabilityKey.purchasing);
}
