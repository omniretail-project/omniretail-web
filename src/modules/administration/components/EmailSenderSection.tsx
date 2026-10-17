"use client";

import type { EmailSenderConfigInputDto } from "@/modules/administration/application/dto/EmailSenderConfigDto";
import { EmailSenderForm } from "@/modules/administration/components/EmailSenderForm";
import { useEmailSenderConfig } from "@/modules/administration/hooks/useEmailSenderConfig";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { useToast } from "@/shared/components/Toast";

/**
 * Sección "Correo y notificaciones" de Configuración del negocio. No se renderiza sin
 * `admin.email_config.read`; las acciones exigen `admin.email_config.manage` (también validado en
 * los services, no solo aquí).
 */
export function EmailSenderSection() {
  const { busy, canManage, canRead, config, disconnect, error, loading, save, sendTest, userEmail } =
    useEmailSenderConfig();
  const { showToast } = useToast();

  if (!canRead) return null;

  function notifyError(title: string, caughtError: unknown) {
    showToast({
      title,
      description:
        caughtError instanceof Error ? caughtError.message : "Inténtelo nuevamente en unos momentos.",
      tone: "danger",
    });
  }

  async function handleSave(input: EmailSenderConfigInputDto) {
    try {
      await save(input);
      showToast({
        title: "Correo remitente guardado",
        description: "Envía un correo de prueba para verificar las credenciales.",
        tone: "success",
      });
    } catch (caughtError) {
      notifyError("No se pudo guardar el correo remitente", caughtError);
      throw caughtError;
    }
  }

  async function handleTest(recipient: string) {
    try {
      const result = await sendTest(recipient);
      showToast({
        title: "Correo de prueba enviado",
        description: `Revisa la bandeja de ${recipient.trim()}. Estado: ${result.status === "VERIFIED" ? "verificado" : "pendiente"}.`,
        tone: "success",
      });
    } catch (caughtError) {
      notifyError("No se pudo enviar el correo de prueba", caughtError);
      throw caughtError;
    }
  }

  async function handleDisconnect() {
    try {
      await disconnect();
      showToast({ title: "Correo remitente desconectado", tone: "success" });
    } catch (caughtError) {
      notifyError("No se pudo desconectar el correo remitente", caughtError);
      throw caughtError;
    }
  }

  if (loading && !config) {
    return (
      <div
        aria-live="polite"
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-muted)] shadow-sm"
      >
        Cargando correo y notificaciones...
      </div>
    );
  }

  if (!config) {
    return error ? <InlineAlert title={error} tone="danger" /> : null;
  }

  return (
    <div className="space-y-3">
      {error ? <InlineAlert title={error} tone="danger" /> : null}
      <EmailSenderForm
        busy={busy}
        canManage={canManage}
        config={config}
        defaultTestRecipient={userEmail}
        key={`${config.configured}|${config.senderEmail ?? ""}|${config.senderName ?? ""}`}
        onDisconnect={handleDisconnect}
        onSave={handleSave}
        onTest={handleTest}
      />
    </div>
  );
}
