import type { EmailSenderConfig } from "@/core/entities";
import type { EmailSenderConfigDto } from "@/modules/administration/application/dto/EmailSenderConfigDto";

export function toEmailSenderConfigDto(config: EmailSenderConfig): EmailSenderConfigDto {
  return {
    provider: config.provider,
    senderEmail: config.senderEmail,
    senderName: config.senderName,
    configured: config.configured,
    status: config.status,
    lastVerifiedAt: config.lastVerifiedAt,
    lastFailureAt: config.lastFailureAt,
  };
}
