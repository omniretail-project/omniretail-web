import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { BusinessConfigDto } from "@/modules/administration/application/dto/BusinessConfigDto";
import { toBusinessConfigDto } from "@/modules/administration/application/mappers/BusinessConfigMapper";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";

export class GetBusinessConfigService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string): Promise<BusinessConfigDto> {
    const config = await this.repositories.businessConfig.getCapabilities(tenantId);
    if (!config) {
      throw new AdministrationServiceError("La configuración del negocio no está disponible.");
    }

    return toBusinessConfigDto(config);
  }
}
