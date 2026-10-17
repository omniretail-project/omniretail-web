import type { Branch, Product, User } from "@/core/entities";
import { SaasCapabilityKey } from "@/core/enums";
import { canUserOperateBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import type { MappedBusinessCapabilityKey } from "@/shared/application/services/businessCapabilityEntitlement";
import { isEffectiveBusinessCapabilityEnabled } from "@/shared/application/services/businessCapabilityEntitlement";
import type { TenantEntitlementsDto } from "@/shared/application/dto/EntitlementDto";
import { ensureTenantCapability, SaasEntitlementError } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

export const INVENTORY_STOCK_READ_PERMISSION = "inventory.stock.read";
export const INVENTORY_MOVEMENTS_READ_PERMISSION = "inventory.movements.read";
export const INVENTORY_ADJUSTMENT_CREATE_PERMISSION = "inventory.adjustment.create";
export const INVENTORY_TRANSFERS_MANAGE_PERMISSION = "inventory.transfers.manage";

export class InventoryServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryServiceError";
  }
}

export interface InventorySessionContext {
  tenantId: string;
  actorUserId: string;
  user: User;
  permissions: readonly string[];
}

/**
 * Fuente autoritativa para Inventory permission-hardening: tenant, actor, permisos y alcance de
 * sucursales salen de la sesion actual, nunca del DTO ni del hook que llama al service.
 */
export async function resolveInventoryContext(
  repositories: RepositoryRegistry,
): Promise<InventorySessionContext> {
  const snapshot = await resolveCurrentSessionSnapshot(repositories);
  if (!snapshot.user || !snapshot.role) {
    throw new InventoryServiceError(snapshot.error ?? "No se pudo resolver la sesión actual.");
  }
  return {
    tenantId: snapshot.user.tenantId,
    actorUserId: snapshot.user.id,
    user: snapshot.user,
    permissions: snapshot.role.permissions,
  };
}

export function ensureCanReadStock(permissions: readonly string[]) {
  if (permissions.includes(INVENTORY_STOCK_READ_PERMISSION)) return;
  throw new InventoryServiceError("No dispone de permisos para consultar stock.");
}

export function ensureCanReadMovements(permissions: readonly string[]) {
  if (permissions.includes(INVENTORY_MOVEMENTS_READ_PERMISSION)) return;
  throw new InventoryServiceError("No dispone de permisos para consultar movimientos de inventario.");
}

export function ensureCanCreateAdjustment(permissions: readonly string[]) {
  if (permissions.includes(INVENTORY_ADJUSTMENT_CREATE_PERMISSION)) return;
  throw new InventoryServiceError("No dispone de permisos para registrar ajustes de inventario.");
}

export function ensureCanManageTransfers(permissions: readonly string[]) {
  if (permissions.includes(INVENTORY_TRANSFERS_MANAGE_PERMISSION)) return;
  throw new InventoryServiceError("No dispone de permisos para gestionar traslados de inventario.");
}

export async function ensureInventoryBranchBelongsToTenant(
  repositories: RepositoryRegistry,
  tenantId: string,
  branchId: string,
): Promise<Branch> {
  const branch = await repositories.branches.getById(branchId);
  if (!branch || branch.tenantId !== tenantId) {
    throw new InventoryServiceError("La sucursal seleccionada no está disponible para este negocio.");
  }
  return branch;
}

export async function ensureUserCanOperateInventoryBranch(
  repositories: RepositoryRegistry,
  user: User,
  branchId: string,
): Promise<Branch> {
  const branch = await ensureInventoryBranchBelongsToTenant(repositories, user.tenantId, branchId);
  if (!canUserOperateBranch(user, branch)) {
    throw new InventoryServiceError("No dispone de acceso a la sucursal seleccionada.");
  }
  return branch;
}

export function ensureProductBelongsToTenant(product: Product | null, tenantId: string): Product {
  if (product?.tenantId === tenantId) return product;
  throw new InventoryServiceError("Producto no encontrado.");
}

export function cleanInventoryError(error: unknown, fallback = "No se pudo completar la operación.") {
  if (error instanceof InventoryServiceError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * Capa de entitlement SaaS (feature/saas-entitlement-enforcement, auditoría §11) -- se suma a
 * `ensureCanCreateAdjustment`/`ensureCanManageTransfers`, nunca los sustituye: Plan sin
 * `inventory` + Role con el permiso = DENIED igual. Devuelve los entitlements resueltos para que
 * el caller pueda además chequear traceability (`ensureTenantCanUseTracking`) sin resolver dos
 * veces.
 */
export async function ensureTenantCanUseInventory(
  repositories: RepositoryRegistry,
  tenantId: string,
): Promise<TenantEntitlementsDto> {
  const entitlements = await new ResolveTenantEntitlementsService(repositories).execute(tenantId);
  ensureTenantCapability(entitlements, SaasCapabilityKey.inventory);
  return entitlements;
}

/**
 * Trazabilidad adaptable (auditoría §20-22): solo exige la capability SaaS
 * (`traceability.lots`/`.expiration`/`.serials`) cuando el PRODUCTO efectivamente la necesita
 * (`product.tracking.lot/expiration/serial`) -- un producto sin esa trazabilidad nunca queda
 * bloqueado por un Plan que no la incluye. Compone AND con `BusinessCapabilitiesConfig.supportsX`
 * (config operativa) vía `isEffectiveBusinessCapabilityEnabled`: ambos ejes son independientes,
 * ninguno sustituye al otro (auditoría §17).
 */
export function ensureTenantCanUseTracking(
  entitlements: TenantEntitlementsDto,
  businessCapabilities: Pick<
    Parameters<typeof isEffectiveBusinessCapabilityEnabled>[1],
    MappedBusinessCapabilityKey
  >,
  product: Pick<Product, "tracking">,
): void {
  const checks: Array<[boolean, MappedBusinessCapabilityKey]> = [
    [product.tracking.lot, "supportsLots"],
    [product.tracking.expiration, "supportsExpiration"],
    [product.tracking.serial, "supportsSerials"],
  ];
  for (const [required, key] of checks) {
    if (!required) continue;
    if (!isEffectiveBusinessCapabilityEnabled(entitlements, businessCapabilities, key)) {
      throw new SaasEntitlementError(
        "CAPABILITY_REQUIRED",
        "Esta operación requiere trazabilidad que no está disponible en tu plan o configuración actual.",
      );
    }
  }
}
