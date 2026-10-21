import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveAdminActorContext } from "@/modules/administration/application/services/resolveAdminActorContext";
import { ensureCanManageShippingConfig } from "@/modules/administration/application/services/serviceHelpers";

export interface ShippingConfigAdminContext {
  tenantId: string;
  actorUserId: string;
}

/**
 * El permiso se verifica aquí (capa de aplicación), no solo en la pantalla: el costo de envío
 * cambia lo que cobran la tienda en línea y el POS de todo el tenant.
 */
export async function resolveShippingConfigAdminContext(
  repositories: RepositoryRegistry,
): Promise<ShippingConfigAdminContext> {
  const { tenantId, actorUserId, permissions } = await resolveAdminActorContext(repositories);
  ensureCanManageShippingConfig(permissions);
  return { tenantId, actorUserId };
}
