import type { BranchScope, Role, Session, Tenant, User } from "@/core/entities";
import type { RoleStatus, TenantStatus, UserStatus, UserType } from "@/core/enums";
import type { CurrencyCode } from "@/core/types/common.types";
import type { ApiCurrentSession } from "@/infrastructure/api/apiCurrentSession";

export function toUser(current: ApiCurrentSession): User {
  const { user } = current;
  return {
    id: user.id,
    tenantId: user.tenantId,
    customerId: user.customerId ?? undefined,
    employeeCode: user.employeeCode ?? undefined,
    name: user.name,
    email: user.email,
    phone: user.phone ?? undefined,
    type: user.type as UserType,
    status: user.status as UserStatus,
    roleId: user.roleId ?? undefined,
    branchId: user.branchId ?? undefined,
    allowedBranchIds: user.allowedBranchIds,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** null si /auth/me no trae rol (cliente sin rol activo). */
export function toRole(current: ApiCurrentSession): Role | null {
  const { role } = current;
  if (!role) return null;
  return {
    id: role.id,
    tenantId: role.tenantId,
    name: role.name,
    description: role.description ?? undefined,
    isSystem: role.isSystem,
    permissions: role.permissions,
    branchScope: role.branchScope as BranchScope,
    status: role.status as RoleStatus,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export function toTenant(current: ApiCurrentSession): Tenant {
  const { tenant } = current;
  return {
    id: tenant.id,
    name: tenant.name,
    legalName: tenant.legalName ?? undefined,
    slug: tenant.slug,
    status: tenant.status as TenantStatus,
    defaultCurrency: tenant.defaultCurrency as CurrencyCode,
    timezone: tenant.timezone,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

export function toSession(current: ApiCurrentSession): Session {
  return {
    id: current.session.id,
    userId: current.user.id,
    createdAt: current.session.createdAt,
    expiresAt: current.session.expiresAt,
    rememberMe: current.session.rememberMe ?? false,
    activeBranchId: current.session.activeBranchId ?? undefined,
    deviceLabel: current.session.deviceLabel ?? undefined,
  };
}
