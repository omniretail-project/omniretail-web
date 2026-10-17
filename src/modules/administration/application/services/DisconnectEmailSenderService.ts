import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { EmailSenderConfigDto } from "@/modules/administration/application/dto/EmailSenderConfigDto";
import { toEmailSenderConfigDto } from "@/modules/administration/application/mappers/EmailSenderConfigMapper";
import { resolveEmailSenderAdminContext } from "@/modules/administration/application/services/resolveEmailSenderAdminContext";

export class DisconnectEmailSenderService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(): Promise<EmailSenderConfigDto> {
    const { tenantId, actorUserId } = await resolveEmailSenderAdminContext(
      this.repositories,
      "manage",
    );
    const config = await this.repositories.emailSender.disconnect(tenantId);
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "email_sender.disconnected",
      entityType: "EmailSenderConfig",
      entityId: tenantId,
      metadata: {},
    });

    return toEmailSenderConfigDto(config);
  }
}
