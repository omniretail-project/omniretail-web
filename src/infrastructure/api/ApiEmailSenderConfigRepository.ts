import type { EmailSenderConfig } from "@/core/entities";
import type { EmailSenderConfigRepository, SaveEmailSenderConfigInput } from "@/core/repositories";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  type ApiEmailSender,
  notConfiguredEmailSender,
  toEmailSenderConfig,
  toEmailSenderRequest,
} from "@/infrastructure/api/apiEmailSenderMapper";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";

const EMAIL_SENDER_PATH = "/administration/email-sender";

/**
 * EmailSenderConfigRepository de modo api. El backend resuelve el tenant desde el JWT, asi que
 * `tenantId` solo etiqueta la respuesta; nunca se envia. La App Password solo viaja en el cuerpo del
 * PUT por HTTPS y no se conserva en ningun estado del cliente ni se devuelve nunca.
 */
export class ApiEmailSenderConfigRepository implements EmailSenderConfigRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async get(tenantId: string): Promise<EmailSenderConfig> {
    try {
      return toEmailSenderConfig(await backendFetch<ApiEmailSender>(EMAIL_SENDER_PATH), tenantId);
    } catch (error) {
      // Sin configuracion previa el contrato es "NOT_CONFIGURED", no un error.
      if (error instanceof BackendRequestError && error.status === 404) {
        return notConfiguredEmailSender(tenantId);
      }
      throw error;
    }
  }

  async save(tenantId: string, input: SaveEmailSenderConfigInput): Promise<EmailSenderConfig> {
    const saved = toEmailSenderConfig(
      await backendFetch<ApiEmailSender>(EMAIL_SENDER_PATH, {
        method: "PUT",
        body: toEmailSenderRequest(input),
      }),
      tenantId,
    );
    this.emitChanged(tenantId);
    return saved;
  }

  async sendTest(tenantId: string, recipient: string): Promise<EmailSenderConfig> {
    try {
      const tested = toEmailSenderConfig(
        await backendFetch<ApiEmailSender>(`${EMAIL_SENDER_PATH}/test`, {
          method: "POST",
          body: { recipient },
        }),
        tenantId,
      );
      this.emitChanged(tenantId);
      return tested;
    } catch (error) {
      // Un rechazo de Gmail deja el estado en ERROR en el backend: se refresca la vista.
      this.emitChanged(tenantId);
      throw error;
    }
  }

  async disconnect(tenantId: string): Promise<EmailSenderConfig> {
    await backendFetch<void>(EMAIL_SENDER_PATH, { method: "DELETE" });
    this.emitChanged(tenantId);
    return notConfiguredEmailSender(tenantId);
  }

  private emitChanged(tenantId: string): void {
    this.eventBus.emit("email-sender.changed", { tenantId });
  }
}
