import type { EmailSenderConfig } from "@/core/entities";

export type EmailSenderConfigDto = Omit<EmailSenderConfig, "tenantId">;

/**
 * `appPassword` es write-only: solo existe en este input, nunca en `EmailSenderConfigDto` ni en
 * ninguna respuesta. Quien lo captura debe descartarlo tras guardar.
 */
export interface EmailSenderConfigInputDto {
  senderEmail: string;
  senderName: string;
  appPassword?: string;
}
