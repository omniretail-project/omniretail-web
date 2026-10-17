"use client";

import { useState, type FormEvent } from "react";
import type {
  EmailSenderConfigDto,
  EmailSenderConfigInputDto,
} from "@/modules/administration/application/dto/EmailSenderConfigDto";
import type { EmailSenderBusyAction } from "@/modules/administration/hooks/useEmailSenderConfig";
import {
  EMAIL_SENDER_NAME_MAX_LENGTH,
  getEmailSenderFieldErrors,
  type EmailSenderFieldErrors,
} from "@/modules/administration/validation/emailSender.validation";
import { EMAIL_MAX_LENGTH } from "@/config/email-policy";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { PasswordInput } from "@/shared/components/PasswordInput";
import { StatusBadge } from "@/shared/components/StatusBadge";

interface EmailSenderFormProps {
  config: EmailSenderConfigDto;
  canManage: boolean;
  busy: EmailSenderBusyAction | null;
  defaultTestRecipient: string;
  onSave: (input: EmailSenderConfigInputDto) => Promise<void>;
  onTest: (recipient: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

const STATUS_PRESENTATION = {
  NOT_CONFIGURED: { label: "No configurado", tone: "neutral" },
  CONFIGURED: { label: "Configurado, sin verificar", tone: "warning" },
  VERIFIED: { label: "Verificado", tone: "success" },
  ERROR: { label: "Error de envío", tone: "danger" },
} as const;

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "short", timeStyle: "short" }).format(date);
}

const APP_PASSWORDS_URL = "https://myaccount.google.com/apppasswords";

/** Guía para quien nunca generó una contraseña de aplicación de Google. */
function AppPasswordGuide() {
  return (
    <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-[var(--color-title)]">
        ¿Cómo obtengo la contraseña de aplicación?
      </summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-[var(--color-text)]">
        <li>
          Inicia sesión con la cuenta de Gmail que enviará los correos del negocio y activa la{" "}
          <strong>verificación en 2 pasos</strong> (Cuenta de Google → Seguridad). Sin ella, Google no
          permite crear contraseñas de aplicación.
        </li>
        <li>
          Abre{" "}
          <a
            className="font-semibold text-[var(--color-structure)] underline"
            href={APP_PASSWORDS_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            myaccount.google.com/apppasswords
          </a>
          .
        </li>
        <li>
          Escribe un nombre, por ejemplo <strong>OmniRetail</strong>, y pulsa <strong>Crear</strong>.
        </li>
        <li>
          Google muestra un código de 16 letras en 4 grupos. Cópialo y pégalo aquí: no se vuelve a
          mostrar.
        </li>
      </ol>
      <p className="mt-3 text-xs text-[var(--color-text-muted)]">
        Si la opción no aparece, la cuenta no tiene la verificación en 2 pasos activa o su administrador
        de Google Workspace la tiene bloqueada. No uses la contraseña normal de tu correo.
      </p>
    </details>
  );
}

/**
 * La App Password es write-only: este formulario nunca la recibe del backend ni la muestra. El
 * padre lo remonta (`key`) tras guardar/desconectar, así el campo siempre vuelve vacío.
 */
export function EmailSenderForm({
  config,
  canManage,
  busy,
  defaultTestRecipient,
  onSave,
  onTest,
  onDisconnect,
}: EmailSenderFormProps) {
  const [senderName, setSenderName] = useState(config.senderName ?? "");
  const [senderEmail, setSenderEmail] = useState(config.senderEmail ?? "");
  const [appPassword, setAppPassword] = useState("");
  const [changingCredentials, setChangingCredentials] = useState(false);
  const [testRecipient, setTestRecipient] = useState(defaultTestRecipient || config.senderEmail || "");
  const [fieldErrors, setFieldErrors] = useState<EmailSenderFieldErrors>({});
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const status = STATUS_PRESENTATION[config.status];
  const emailChanged = senderEmail.trim().toLowerCase() !== (config.senderEmail ?? "");
  const passwordRequired = !config.configured || emailChanged;
  const showPasswordField = canManage && (passwordRequired || changingCredentials);
  const dirty =
    senderName.trim() !== (config.senderName ?? "") || emailChanged || appPassword.length > 0;
  const disabled = !canManage || busy !== null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: EmailSenderConfigInputDto = {
      senderEmail,
      senderName,
      appPassword: appPassword || undefined,
    };
    const errors = getEmailSenderFieldErrors(input, { passwordRequired });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      await onSave(input);
      setAppPassword("");
      setChangingCredentials(false);
    } catch {
      // El error lo muestra el padre; se conserva lo escrito salvo la contraseña.
      setAppPassword("");
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="flex flex-col gap-2 border-b border-[var(--color-border)] pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-title)]">Correo y notificaciones</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Cuenta de Gmail desde la que el sistema envía pedidos, envíos y otros correos del
            negocio. Es distinta del correo público de contacto de la tienda.
          </p>
        </div>
        <StatusBadge status={status.label} tone={status.tone} />
      </div>

      <form className="mt-4 space-y-4" noValidate onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={fieldErrors.senderName} id="email-sender-name" label="Nombre del remitente">
            <Input
              disabled={disabled}
              id="email-sender-name"
              maxLength={EMAIL_SENDER_NAME_MAX_LENGTH}
              onChange={(event) => setSenderName(event.target.value)}
              value={senderName}
            />
          </FormField>
          <FormField error={fieldErrors.senderEmail} id="email-sender-email" label="Correo Gmail">
            <Input
              autoComplete="off"
              disabled={disabled}
              id="email-sender-email"
              maxLength={EMAIL_MAX_LENGTH}
              onChange={(event) => setSenderEmail(event.target.value)}
              type="email"
              value={senderEmail}
            />
          </FormField>
        </div>

        {showPasswordField ? (
          <FormField
            error={fieldErrors.appPassword}
            hint="Es un código de 16 letras que genera Google, distinto de la contraseña de tu correo. Se guarda cifrada y no se vuelve a mostrar."
            id="email-sender-app-password"
            label="Contraseña de aplicación"
          >
            <PasswordInput
              autoComplete="new-password"
              disabled={disabled}
              id="email-sender-app-password"
              onChange={(event) => setAppPassword(event.target.value)}
              spellCheck={false}
              value={appPassword}
            />
          </FormField>
        ) : config.configured ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Credenciales guardadas. Por seguridad no se muestran.
          </p>
        ) : null}

        {showPasswordField ? <AppPasswordGuide /> : null}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--color-text)]">Última verificación</dt>
            <dd className="text-[var(--color-text-muted)]">{formatDateTime(config.lastVerifiedAt)}</dd>
          </div>
          {config.status === "ERROR" ? (
            <div>
              <dt className="font-semibold text-[var(--color-text)]">Último fallo</dt>
              <dd className="text-[var(--color-text-muted)]">{formatDateTime(config.lastFailureAt)}</dd>
            </div>
          ) : null}
        </dl>

        {canManage ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] pt-4">
            <Button disabled={disabled || !dirty} type="submit">
              {busy === "save" ? "Guardando..." : "Guardar configuración"}
            </Button>
            {config.configured && !passwordRequired && !changingCredentials ? (
              <Button
                disabled={disabled}
                onClick={() => setChangingCredentials(true)}
                type="button"
                variant="secondary"
              >
                Cambiar credenciales
              </Button>
            ) : null}
            {config.configured ? (
              <Button
                disabled={disabled}
                onClick={() => setConfirmDisconnect(true)}
                type="button"
                variant="ghost"
              >
                Desconectar
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>

      {canManage && config.configured ? (
        <div className="mt-4 grid gap-3 border-t border-[var(--color-border)] pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <FormField
            hint="Verifica que Gmail acepta las credenciales guardadas."
            id="email-sender-test-recipient"
            label="Enviar correo de prueba a"
          >
            <Input
              disabled={disabled || dirty}
              id="email-sender-test-recipient"
              maxLength={EMAIL_MAX_LENGTH}
              onChange={(event) => setTestRecipient(event.target.value)}
              type="email"
              value={testRecipient}
            />
          </FormField>
          <Button
            disabled={disabled || dirty}
            onClick={() => void onTest(testRecipient).catch(() => undefined)}
            type="button"
            variant="secondary"
          >
            {busy === "test" ? "Enviando..." : "Enviar correo de prueba"}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        confirmLabel="Desconectar"
        message="Se eliminarán el remitente y la contraseña guardada. Los correos del negocio dejarán de enviarse hasta configurar una nueva cuenta."
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => {
          setConfirmDisconnect(false);
          void onDisconnect().catch(() => undefined);
        }}
        open={confirmDisconnect}
        title="¿Desconectar el correo remitente?"
      />
    </section>
  );
}
