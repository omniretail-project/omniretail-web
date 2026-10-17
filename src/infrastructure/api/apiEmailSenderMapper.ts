import type { EmailSenderConfig, EmailSenderProvider, EmailSenderStatus } from "@/core/entities";
import type { SaveEmailSenderConfigInput } from "@/core/repositories";

/**
 * EmailSenderResponse del backend (`/administration/email-sender`). El backend nunca devuelve la
 * App Password ni ningun derivado de ella; `configured` es lo unico que se sabe del secreto.
 */
export interface ApiEmailSender {
  provider?: string | null;
  senderEmail?: string | null;
  senderName?: string | null;
  configured?: boolean | null;
  status?: string | null;
  lastVerifiedAt?: string | null;
  lastFailureAt?: string | null;
}

export interface ApiEmailSenderRequest {
  provider: EmailSenderProvider;
  senderEmail: string;
  senderName: string;
  appPassword?: string;
}

const STATUSES: readonly EmailSenderStatus[] = ["NOT_CONFIGURED", "CONFIGURED", "VERIFIED", "ERROR"];

function toStatus(value: string | null | undefined, configured: boolean): EmailSenderStatus {
  const status = STATUSES.find((candidate) => candidate === value);
  if (status) return status;
  return configured ? "CONFIGURED" : "NOT_CONFIGURED";
}

export function toEmailSenderConfig(response: ApiEmailSender, tenantId: string): EmailSenderConfig {
  const configured = response.configured === true;
  return {
    tenantId,
    provider: "GMAIL_SMTP",
    senderEmail: response.senderEmail ?? undefined,
    senderName: response.senderName ?? undefined,
    configured,
    status: toStatus(response.status, configured),
    lastVerifiedAt: response.lastVerifiedAt ?? undefined,
    lastFailureAt: response.lastFailureAt ?? undefined,
  };
}

export function notConfiguredEmailSender(tenantId: string): EmailSenderConfig {
  return { tenantId, provider: "GMAIL_SMTP", configured: false, status: "NOT_CONFIGURED" };
}

export function toEmailSenderRequest(input: SaveEmailSenderConfigInput): ApiEmailSenderRequest {
  return {
    provider: input.provider,
    senderEmail: input.senderEmail,
    senderName: input.senderName,
    // Solo se envia cuando hay una contrasena nueva; omitirla conserva la credencial guardada.
    ...(input.appPassword ? { appPassword: input.appPassword } : {}),
  };
}
