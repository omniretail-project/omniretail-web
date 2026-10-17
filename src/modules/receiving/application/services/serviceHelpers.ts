import type { Branch, User } from "@/core/entities";
import { SaasCapabilityKey } from "@/core/enums";
import { canUserOperateBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import { ensureTenantCapability } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

export class ReceivingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceivingServiceError";
  }
}

export interface ReceivingSessionContext {
  tenantId: string;
  actorUserId: string;
  user: User;
  permissions: readonly string[];
}

/**
 * Unica fuente de tenant/actor/permisos para Receiving -- permission-hardening
 * (feature/permission-hardening-purchasing-receiving). Antes de este fix,
 * `ReceivingDocumentDetailService`/`ReceivingDocumentsService` recibian `activeBranchId` como
 * parametro OPCIONAL del cliente y lo usaban, cuando estaba presente, solo como filtro -- sin
 * `activeBranchId` la validacion de tenant/branch directamente desaparecia. Ahora tenant/actor
 * SIEMPRE salen de la sesion, nunca de un parametro que el llamador puede omitir.
 */
export async function resolveReceivingContext(
  repositories: RepositoryRegistry,
): Promise<ReceivingSessionContext> {
  const snapshot = await resolveCurrentSessionSnapshot(repositories);
  if (!snapshot.user || !snapshot.role) {
    throw new ReceivingServiceError("No se pudo resolver el negocio activo.");
  }
  return {
    tenantId: snapshot.user.tenantId,
    actorUserId: snapshot.user.id,
    user: snapshot.user,
    permissions: snapshot.role.permissions,
  };
}

/** `.create`/`.confirm` implican poder leer -- mismo criterio que Purchasing/Categorias/Products. */
export function ensureCanReadReceiving(permissions: readonly string[]) {
  if (
    permissions.includes("receiving.receipts.read") ||
    permissions.includes("receiving.receipts.create") ||
    permissions.includes("receiving.receipts.confirm")
  ) {
    return;
  }
  throw new ReceivingServiceError("No dispone de permisos para consultar recepciones.");
}

/**
 * Cubre guardar avance de recepcion (borrador, `saveProgress`) -- quien puede confirmar
 * tambien puede guardar avances parciales antes de confirmar.
 */
export function ensureCanSaveReceivingProgress(permissions: readonly string[]) {
  if (
    permissions.includes("receiving.receipts.create") ||
    permissions.includes("receiving.receipts.confirm")
  ) {
    return;
  }
  throw new ReceivingServiceError("No dispone de permisos para registrar avances de recepción.");
}

export function ensureCanConfirmReceiving(permissions: readonly string[]) {
  if (permissions.includes("receiving.receipts.confirm")) return;
  throw new ReceivingServiceError("No dispone de permisos para confirmar recepciones.");
}

export function ensureCanManageIncidentTypes(permissions: readonly string[]) {
  ensureCanManageReceivingIncidents(permissions);
}

export function ensureCanManageReceivingIncidents(permissions: readonly string[]) {
  if (permissions.includes("receiving.incidents.manage")) return;
  throw new ReceivingServiceError("No dispone de permisos para gestionar incidencias.");
}

/** Validacion de sucursal contra `User.allowedBranchIds` (fuente autoritativa desde #94). */
export async function ensureUserCanOperateBranch(
  repositories: RepositoryRegistry,
  user: User,
  branchId: string,
): Promise<Branch> {
  const branch = await repositories.branches.getById(branchId);
  if (!branch || branch.tenantId !== user.tenantId) {
    throw new ReceivingServiceError(
      "La sucursal seleccionada no está disponible para este negocio.",
    );
  }
  if (!canUserOperateBranch(user, branch)) {
    throw new ReceivingServiceError("No dispone de acceso a la sucursal seleccionada.");
  }
  return branch;
}

export function cleanError(error: unknown): string {
  if (error instanceof ReceivingServiceError) return error.message;
  if (error instanceof Error) return error.message;
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

/**
 * Capa de entitlement SaaS (feature/saas-entitlement-enforcement, auditoría §13) -- se suma a
 * `ensureCanSaveReceivingProgress`/`ensureCanConfirmReceiving`/`ensureCanManageIncidentTypes`,
 * nunca los sustituye. El read model histórico (`getDocument`) sigue gobernado únicamente por
 * `ensureCanReadReceiving`.
 */
export async function ensureTenantCanUseReceiving(
  repositories: RepositoryRegistry,
  tenantId: string,
): Promise<void> {
  const entitlements = await new ResolveTenantEntitlementsService(repositories).execute(tenantId);
  ensureTenantCapability(entitlements, SaasCapabilityKey.receiving);
}
