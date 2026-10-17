import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  SupplierDto,
  SupplierInputDto,
} from "@/modules/administration/application/dto/SupplierDto";
import { toSupplierDto } from "@/modules/administration/application/mappers/SupplierMapper";
import {
  ensureCanManageSuppliers,
  ensureSupplierActor,
  ensureSupplierTenant,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  normalizeSupplierInput,
  validateSupplierInput,
} from "@/modules/administration/validation/supplier.validation";

export class CreateSupplierService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    dto: SupplierInputDto,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<SupplierDto> {
    ensureCanManageSuppliers(permissions);
    ensureSupplierTenant(tenantId);
    ensureSupplierActor(actorUserId);
    const normalizedInput = normalizeSupplierInput(dto);
    validateSupplierInput(normalizedInput);

    const supplier = await this.repositories.suppliers.create({
      tenantId,
      ...normalizedInput,
    });
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "supplier.created",
      entityType: "Supplier",
      entityId: supplier.id,
      metadata: {
        name: supplier.name,
        status: supplier.status,
      },
    });

    return toSupplierDto(supplier);
  }
}
