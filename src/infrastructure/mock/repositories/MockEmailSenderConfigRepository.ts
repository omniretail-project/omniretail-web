import type { EmailSenderConfig } from "@/core/entities";
import type { EmailSenderConfigRepository, SaveEmailSenderConfigInput } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

/**
 * Simula solo el ESTADO del remitente. Deliberadamente NO usa MockDatabaseStore/localStorage y
 * descarta `appPassword`: un secreto jamas debe persistir en el navegador, ni siquiera en el mock.
 * El estado vive en memoria y se reinicia al recargar la pagina.
 */
export class MockEmailSenderConfigRepository
  extends BaseMockRepository
  implements EmailSenderConfigRepository
{
  private readonly configs = new Map<string, EmailSenderConfig>();

  async get(tenantId: string): Promise<EmailSenderConfig> {
    return { ...this.current(tenantId) };
  }

  async save(tenantId: string, input: SaveEmailSenderConfigInput): Promise<EmailSenderConfig> {
    const previous = this.configs.get(tenantId);
    const credentialsChanged =
      !previous?.configured ||
      Boolean(input.appPassword) ||
      previous.senderEmail !== input.senderEmail;
    if (credentialsChanged && !input.appPassword) {
      throw new Error("La contraseña de aplicación es obligatoria para este remitente.");
    }

    const next: EmailSenderConfig = {
      tenantId,
      provider: input.provider,
      senderEmail: input.senderEmail,
      senderName: input.senderName,
      configured: true,
      status: credentialsChanged ? "CONFIGURED" : (previous?.status ?? "CONFIGURED"),
      lastVerifiedAt: credentialsChanged ? undefined : previous?.lastVerifiedAt,
      lastFailureAt: credentialsChanged ? undefined : previous?.lastFailureAt,
    };
    this.configs.set(tenantId, next);
    this.emit("email-sender.changed", { tenantId });
    return { ...next };
  }

  async sendTest(tenantId: string, recipient: string): Promise<EmailSenderConfig> {
    const current = this.configs.get(tenantId);
    if (!current?.configured) {
      throw new Error("Configure el correo remitente antes de enviar una prueba.");
    }
    if (!recipient.trim()) throw new Error("Indique el correo destinatario de la prueba.");

    const next: EmailSenderConfig = {
      ...current,
      status: "VERIFIED",
      lastVerifiedAt: this.now(),
    };
    this.configs.set(tenantId, next);
    this.emit("email-sender.changed", { tenantId });
    return { ...next };
  }

  async disconnect(tenantId: string): Promise<EmailSenderConfig> {
    this.configs.delete(tenantId);
    this.emit("email-sender.changed", { tenantId });
    return { ...this.current(tenantId) };
  }

  private current(tenantId: string): EmailSenderConfig {
    return (
      this.configs.get(tenantId) ?? {
        tenantId,
        provider: "GMAIL_SMTP",
        configured: false,
        status: "NOT_CONFIGURED",
      }
    );
  }
}
