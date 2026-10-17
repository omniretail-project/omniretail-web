import type { User } from "@/core/entities";
import type { UserStatus, UserType } from "@/core/enums";

/** UserResponse del backend (`/administration/users`). */
export interface ApiUser {
  id: string;
  tenantId: string;
  customerId: string | null;
  employeeCode: string | null;
  name: string;
  email: string;
  phone: string | null;
  type: string;
  status: string;
  roleId: string | null;
  branchId: string | null;
  allowedBranchIds: string[] | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * UpdateUserRequest: sin `email`, `type`, `customerId` ni `tenantId` (el backend nunca convierte un
 * empleado en cliente, no cambia el email ni lo muda de tienda).
 */
export interface ApiUpdateUserRequest {
  name: string;
  phone?: string;
  employeeCode: string;
  roleId: string;
  branchId?: string;
  allowedBranchIds: string[];
  status: UserStatus;
}

/** CreateUserRequest: solo empleados, sin password ni `tenantId` (sale del JWT). */
export interface ApiCreateUserRequest extends ApiUpdateUserRequest {
  email: string;
}

type UserInput = Pick<
  User,
  "name" | "phone" | "employeeCode" | "roleId" | "branchId" | "allowedBranchIds" | "status"
>;

export function toUser(user: ApiUser): User {
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
    allowedBranchIds: user.allowedBranchIds ?? [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * El PUT reemplaza el empleado completo y exige `employeeCode` y `roleId`; los services de
 * administration ya los validan, aqui solo se rechaza un payload que el backend no aceptaria.
 */
export function toUpdateUserRequest(input: UserInput): ApiUpdateUserRequest {
  if (!input.employeeCode || !input.roleId) {
    throw new Error("El empleado requiere código y rol.");
  }
  return {
    name: input.name,
    phone: input.phone,
    employeeCode: input.employeeCode,
    roleId: input.roleId,
    branchId: input.branchId,
    allowedBranchIds: input.allowedBranchIds ?? [],
    status: input.status,
  };
}

export function toCreateUserRequest(input: UserInput & Pick<User, "email">): ApiCreateUserRequest {
  return { ...toUpdateUserRequest(input), email: input.email };
}
