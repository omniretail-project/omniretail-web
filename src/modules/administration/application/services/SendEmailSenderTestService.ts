import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { EmailSenderConfigDto } from "@/modules/administration/application/dto/EmailSenderConfigDto";
import { toEmailSenderConfigDto } from "@/modules/administration/application/mappers/EmailSenderConfigMapper";
import { resolveEmailSenderAdminContext } from "@/modules/administration/application/services/resolveEmailSenderAdminContext";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";
import { validateEmail } from "@/config/email-policy";

export class SendEmailSenderTestService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(recipient: string): Promise<EmailSenderConfigDto> {
    const { tenantId, actorUserId } = await resolveEmailSenderAdminContext(
      this.repositories,
      "manage",
    );
    const emailError = validateEmail(recipient);
    if (emailError) throw new AdministrationServiceError(emailError);

    const current = await this.repositories.emailSender.get(tenantId);
    if (!current.configured) {
      throw new AdministrationServiceError("Configure el correo remitente antes de enviar una prueba.");
    }

    const config = await this.repositories.emailSender.sendTest(tenantId, recipient.trim().toLowerCase());
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "email_sender.tested",
      entityType: "EmailSenderConfig",
      entityId: tenantId,
      metadata: { status: config.status },
    });

    return toEmailSenderConfigDto(config);
  }
}
