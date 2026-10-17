import type { EmployeeAuthSummary } from "@/core/repositories";
import type { User } from "@/core/entities";
import type { EmployeeDto } from "@/modules/administration/application/dto/EmployeeDto";

export function toEmployeeDto(user: User, authSummary: EmployeeAuthSummary | undefined): EmployeeDto {
  return {
    id: user.id,
    employeeCode: user.employeeCode,
    name: user.name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    roleId: user.roleId,
    branchId: user.branchId,
    allowedBranchIds: user.allowedBranchIds ?? [],
    authStatus: authSummary?.status,
    mfaEnabled: authSummary?.mfaEnabled ?? false,
    lastLoginAt: authSummary?.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
