import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { EmailSenderConfigDto } from "@/modules/administration/application/dto/EmailSenderConfigDto";
import { toEmailSenderConfigDto } from "@/modules/administration/application/mappers/EmailSenderConfigMapper";
import { resolveEmailSenderAdminContext } from "@/modules/administration/application/services/resolveEmailSenderAdminContext";

export class GetEmailSenderConfigService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(): Promise<EmailSenderConfigDto> {
    const { tenantId } = await resolveEmailSenderAdminContext(this.repositories, "read");
    return toEmailSenderConfigDto(await this.repositories.emailSender.get(tenantId));
  }
}
