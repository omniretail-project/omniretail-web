import type { Branch } from "@/core/entities";
import type { BranchStatus, BranchType } from "@/core/enums";

/** BranchResponse del backend (`/administration/branches`). */
export interface ApiBranch {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Respuesta de `GET /auth/session/branches`: solo las sucursales activas asignadas al empleado de
 * la sesion. Es un contrato acotado, por eso solo `id`, `code`, `name`, `type` y `status` son
 * obligatorios; el resto se completa con los datos de la sesion.
 */
export type ApiSessionBranch = Pick<ApiBranch, "id" | "code" | "name" | "type" | "status"> &
  Partial<Omit<ApiBranch, "id" | "code" | "name" | "type" | "status">>;

/** CreateBranchRequest / UpdateBranchRequest: la tienda sale del JWT, nunca del body. */
export interface ApiBranchRequest {
  code: string;
  name: string;
  type: BranchType;
  address?: string;
  phone?: string;
  email?: string;
  status: BranchStatus;
}

type BranchInput = Omit<Branch, "id" | "tenantId" | "createdAt" | "updatedAt">;

export function toBranch(branch: ApiBranch): Branch {
  return {
    id: branch.id,
    tenantId: branch.tenantId,
    code: branch.code,
    name: branch.name,
    type: branch.type as BranchType,
    address: branch.address ?? undefined,
    phone: branch.phone ?? undefined,
    email: branch.email ?? undefined,
    status: branch.status as BranchStatus,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}

export function toSessionBranch(
  branch: ApiSessionBranch,
  tenantId: string,
  fetchedAt: string,
): Branch {
  return toBranch({
    ...branch,
    tenantId: branch.tenantId ?? tenantId,
    address: branch.address ?? null,
    phone: branch.phone ?? null,
    email: branch.email ?? null,
    createdAt: branch.createdAt ?? fetchedAt,
    updatedAt: branch.updatedAt ?? fetchedAt,
  });
}

/**
 * El PUT del backend reemplaza address/phone/email (null los borra) y exige name y type, por eso
 * se envia siempre la sucursal completa.
 */
export function toBranchRequest(input: BranchInput): ApiBranchRequest {
  return {
    code: input.code,
    name: input.name,
    type: input.type,
    address: input.address,
    phone: input.phone,
    email: input.email,
    status: input.status,
  };
}
