import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { ShippingConfigDto } from "@/modules/administration/application/dto/ShippingConfigDto";
import { resolveShippingConfigAdminContext } from "@/modules/administration/application/services/resolveShippingConfigAdminContext";

export class GetShippingConfigService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(): Promise<ShippingConfigDto> {
    const { tenantId } = await resolveShippingConfigAdminContext(this.repositories);
    const config = await this.repositories.shippingConfig.get(tenantId);
    return { ecommerce: config.ecommerce, pos: config.pos };
  }
}
