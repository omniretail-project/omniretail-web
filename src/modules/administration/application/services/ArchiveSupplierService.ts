import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { SupplierDto } from "@/modules/administration/application/dto/SupplierDto";
import { toSupplierDto } from "@/modules/administration/application/mappers/SupplierMapper";
import {
  ensureCanManageSuppliers,
  ensureSupplierActor,
  ensureSupplierBelongsToTenant,
  ensureSupplierTenant,
} from "@/modules/administration/application/services/serviceHelpers";

export class ArchiveSupplierService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    supplierId: string,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<SupplierDto> {
    ensureCanManageSuppliers(permissions);
    ensureSupplierTenant(tenantId);
    ensureSupplierActor(actorUserId);
    const current = ensureSupplierBelongsToTenant(
      await this.repositories.suppliers.getById(supplierId),
      tenantId,
    );

    const supplier = ensureSupplierBelongsToTenant(
      await this.repositories.suppliers.archive(current.id),
      tenantId,
    );
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "supplier.archived",
      entityType: "Supplier",
      entityId: supplier.id,
      metadata: {
        name: supplier.name,
        previousStatus: current.status,
        status: supplier.status,
      },
    });

    return toSupplierDto(supplier);
  }
}
