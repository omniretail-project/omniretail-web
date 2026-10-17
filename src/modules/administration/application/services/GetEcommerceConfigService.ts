import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { EcommerceConfigDto } from "@/modules/administration/application/dto/EcommerceConfigDto";
import { toEcommerceConfigDto } from "@/modules/administration/application/mappers/EcommerceConfigMapper";
import { resolveEcommerceConfigAdminContext } from "@/modules/administration/application/services/resolveEcommerceConfigAdminContext";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";

export class GetEcommerceConfigService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(): Promise<EcommerceConfigDto> {
    const { tenantId } = await resolveEcommerceConfigAdminContext(this.repositories);
    const config = await this.repositories.businessConfig.getEcommerceConfig(tenantId);

    if (!config) {
      throw new AdministrationServiceError(
        "No se encontro la configuracion de e-commerce del negocio.",
      );
    }

    return toEcommerceConfigDto(config);
  }
}
