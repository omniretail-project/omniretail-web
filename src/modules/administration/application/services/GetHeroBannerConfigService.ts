import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { HeroBannerConfigDto } from "@/modules/administration/application/dto/HeroBannerConfigDto";
import { toHeroBannerConfigDto } from "@/modules/administration/application/mappers/HeroBannerConfigMapper";
import { resolveEcommerceConfigAdminContext } from "@/modules/administration/application/services/resolveEcommerceConfigAdminContext";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";

export class GetHeroBannerConfigService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(): Promise<HeroBannerConfigDto> {
    const { tenantId } = await resolveEcommerceConfigAdminContext(this.repositories);
    const config = await this.repositories.businessConfig.getHeroBanner(tenantId);
    if (!config) {
      throw new AdministrationServiceError("No hay un carrusel configurado para el negocio actual.");
    }
    return toHeroBannerConfigDto(config);
  }
}
