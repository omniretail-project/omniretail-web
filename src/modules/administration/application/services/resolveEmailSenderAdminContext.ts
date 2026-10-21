import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveAdminActorContext } from "@/modules/administration/application/services/resolveAdminActorContext";
import {
  ensureCanManageEmailSender,
  ensureCanReadEmailSender,
} from "@/modules/administration/application/services/serviceHelpers";

export interface EmailSenderAdminContext {
  tenantId: string;
  actorUserId: string;
}

/**
 * El permiso se verifica aquí (capa de aplicación), no solo en la pantalla: ocultar el botón no es
 * enforcement y el remitente de correo afecta a todo el tenant.
 */
export async function resolveEmailSenderAdminContext(
  repositories: RepositoryRegistry,
  access: "read" | "manage",
): Promise<EmailSenderAdminContext> {
  const { tenantId, actorUserId, permissions } = await resolveAdminActorContext(repositories);

  if (access === "manage") ensureCanManageEmailSender(permissions);
  else ensureCanReadEmailSender(permissions);

  return { tenantId, actorUserId };
}
