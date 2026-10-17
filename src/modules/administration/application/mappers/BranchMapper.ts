import type { Branch } from "@/core/entities";
import type { BranchDto } from "@/modules/administration/application/dto/BranchDto";

export function toBranchDto(branch: Branch): BranchDto {
  return {
    id: branch.id,
    code: branch.code,
    name: branch.name,
    type: branch.type,
    address: branch.address,
    phone: branch.phone,
    email: branch.email,
    status: branch.status,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}
