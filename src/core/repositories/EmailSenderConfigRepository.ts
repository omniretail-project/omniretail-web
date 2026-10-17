import type { EmailSenderConfig, EmailSenderProvider } from "@/core/entities";

/**
 * `appPassword` es write-only: obligatorio al crear la configuracion o cambiar `senderEmail`,
 * opcional al editar solo `senderName`. Nunca se persiste en el navegador.
 */
export interface SaveEmailSenderConfigInput {
  provider: EmailSenderProvider;
  senderEmail: string;
  senderName: string;
  appPassword?: string;
}

/**
 * Remitente de correo por tenant. El backend resuelve el tenant desde el JWT: `tenantId` solo
 * valida/etiqueta la respuesta y nunca se envia.
 */
export interface EmailSenderConfigRepository {
  /** Siempre devuelve un valor; sin configuracion previa, `status = NOT_CONFIGURED`. */
  get(tenantId: string): Promise<EmailSenderConfig>;
  save(tenantId: string, input: SaveEmailSenderConfigInput): Promise<EmailSenderConfig>;
  /** Envia un correo de prueba y actualiza `status`/`lastVerifiedAt`/`lastFailureAt`. */
  sendTest(tenantId: string, recipient: string): Promise<EmailSenderConfig>;
  /** Elimina credenciales y remitente; el estado vuelve a `NOT_CONFIGURED`. */
  disconnect(tenantId: string): Promise<EmailSenderConfig>;
}
