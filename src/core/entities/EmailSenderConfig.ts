import type { ISODateString } from "@/core/types/common.types";

export type EmailSenderProvider = "GMAIL_SMTP";

/**
 * NOT_CONFIGURED: nunca configurado. CONFIGURED: credenciales guardadas pero sin probar.
 * VERIFIED: ultima prueba/envio correcto. ERROR: ultimo intento fallo.
 */
export type EmailSenderStatus = "NOT_CONFIGURED" | "CONFIGURED" | "VERIFIED" | "ERROR";

/**
 * Remitente de correo del tenant (correos operativos: pedidos, logistica, compras). Es distinto de
 * `EcommerceConfig.contactEmail`, que es el correo publico de contacto de la tienda.
 *
 * Nunca incluye la App Password: el secreto es write-only, solo viaja en `SaveEmailSenderConfigInput`
 * y el backend jamas lo devuelve. `configured` indica unicamente que existen credenciales guardadas.
 */
export interface EmailSenderConfig {
  tenantId: string;
  provider: EmailSenderProvider;
  senderEmail?: string;
  senderName?: string;
  configured: boolean;
  status: EmailSenderStatus;
  lastVerifiedAt?: ISODateString;
  lastFailureAt?: ISODateString;
}
