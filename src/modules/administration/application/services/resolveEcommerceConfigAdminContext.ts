import { SaasCapabilityKey } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import { ensureTenantCapability } from "@/shared/application/services/entitlementGuards";
import { resolveAdminActorContext } from "@/modules/administration/application/services/resolveAdminActorContext";
import { ensureCanManageEcommerceConfig } from "@/modules/administration/application/services/serviceHelpers";

export interface EcommerceConfigAdminContext {
  tenantId: string;
  actorUserId: string;
}

export async function resolveEcommerceConfigAdminContext(
  repositories: RepositoryRegistry,
): Promise<EcommerceConfigAdminContext> {
  const { tenantId, actorUserId, permissions } = await resolveAdminActorContext(repositories);

  ensureCanManageEcommerceConfig(permissions);
  ensureTenantCapability(
    await new ResolveTenantEntitlementsService(repositories).execute(tenantId),
    SaasCapabilityKey.ecommerce,
  );
  return { tenantId, actorUserId };
}
