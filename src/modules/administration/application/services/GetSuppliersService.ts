import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { SupplierDto } from "@/modules/administration/application/dto/SupplierDto";
import { toSupplierDto } from "@/modules/administration/application/mappers/SupplierMapper";
import {
  ensureCanManageSuppliers,
  ensureSupplierTenant,
} from "@/modules/administration/application/services/serviceHelpers";

export class GetSuppliersService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string, permissions: readonly string[]): Promise<SupplierDto[]> {
    ensureCanManageSuppliers(permissions);
    ensureSupplierTenant(tenantId);
    const suppliers = await this.repositories.suppliers.getAll();

    return suppliers.filter((supplier) => supplier.tenantId === tenantId).map(toSupplierDto);
  }
}
