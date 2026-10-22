import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  ShippingConfigDto,
  ShippingConfigFormValue,
} from "@/modules/administration/application/dto/ShippingConfigDto";
import { resolveShippingConfigAdminContext } from "@/modules/administration/application/services/resolveShippingConfigAdminContext";
import { toShippingConfigInput } from "@/modules/administration/validation/shippingConfig.validation";

export class SaveShippingConfigService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(value: ShippingConfigFormValue): Promise<ShippingConfigDto> {
    const { tenantId, actorUserId } = await resolveShippingConfigAdminContext(this.repositories);
    const input = toShippingConfigInput(value);
    const config = await this.repositories.shippingConfig.save(tenantId, input);

    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "shipping_config.updated",
      entityType: "ShippingConfig",
      entityId: tenantId,
      metadata: { ecommerce: { ...config.ecommerce }, pos: { ...config.pos } },
    });

    return { ecommerce: config.ecommerce, pos: config.pos };
  }
}
