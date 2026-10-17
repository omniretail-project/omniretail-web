import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  SupplierDto,
  SupplierInputDto,
} from "@/modules/administration/application/dto/SupplierDto";
import { toSupplierDto } from "@/modules/administration/application/mappers/SupplierMapper";
import {
  ensureCanManageSuppliers,
  ensureSupplierActor,
  ensureSupplierBelongsToTenant,
  ensureSupplierTenant,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  normalizeSupplierInput,
  validateSupplierInput,
} from "@/modules/administration/validation/supplier.validation";

export class UpdateSupplierService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    supplierId: string,
    dto: SupplierInputDto,
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
    const normalizedInput = normalizeSupplierInput(dto);
    validateSupplierInput(normalizedInput);

    const supplier = ensureSupplierBelongsToTenant(
      await this.repositories.suppliers.update(current.id, normalizedInput),
      tenantId,
    );
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "supplier.updated",
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
