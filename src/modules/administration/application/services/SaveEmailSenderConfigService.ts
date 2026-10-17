import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  EmailSenderConfigDto,
  EmailSenderConfigInputDto,
} from "@/modules/administration/application/dto/EmailSenderConfigDto";
import { toEmailSenderConfigDto } from "@/modules/administration/application/mappers/EmailSenderConfigMapper";
import { resolveEmailSenderAdminContext } from "@/modules/administration/application/services/resolveEmailSenderAdminContext";
import {
  normalizeEmailSenderInput,
  validateEmailSenderInput,
} from "@/modules/administration/validation/emailSender.validation";

export class SaveEmailSenderConfigService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(dto: EmailSenderConfigInputDto): Promise<EmailSenderConfigDto> {
    const { tenantId, actorUserId } = await resolveEmailSenderAdminContext(
      this.repositories,
      "manage",
    );
    const current = await this.repositories.emailSender.get(tenantId);
    const input = normalizeEmailSenderInput(dto);
    // La contraseña es obligatoria al crear la configuración o al cambiar de cuenta de Gmail.
    const passwordRequired = !current.configured || current.senderEmail !== input.senderEmail;
    validateEmailSenderInput(dto, { passwordRequired });

    const config = await this.repositories.emailSender.save(tenantId, {
      provider: "GMAIL_SMTP",
      ...input,
    });

    // Auditoría sin secretos: nunca se registra la contraseña de aplicación.
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "email_sender.updated",
      entityType: "EmailSenderConfig",
      entityId: tenantId,
      metadata: {
        provider: config.provider,
        senderEmail: config.senderEmail,
        credentialsChanged: Boolean(input.appPassword),
      },
    });

    return toEmailSenderConfigDto(config);
  }
}
