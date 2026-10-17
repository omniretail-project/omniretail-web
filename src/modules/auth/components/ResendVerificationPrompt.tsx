"use client";

import { useState } from "react";
import { GENERIC_ACCOUNT_EMAIL_MESSAGE } from "@/config/auth-policy";
import { useResendVerification } from "@/modules/auth/hooks/useResendVerification";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";

interface ResendVerificationPromptProps {
  /**
   * Correo a usar. En la pantalla "Revisa tu correo" del registro es fijo (el que se acaba de
   * registrar). En el login de la tienda solo precarga el mini formulario.
   */
  email: string;
  /** true: mini formulario en linea con el correo editable (login de la tienda). */
  editable?: boolean;
}

function resendLabel(label: string, cooldownSeconds: number, isSending: boolean): string {
  if (isSending) return "Enviando...";
  return cooldownSeconds > 0 ? `${label} (${cooldownSeconds} s)` : label;
}

/**
 * "¿No te llegó el correo? Reenviar". Muestra siempre el mismo mensaje generico despues de usarlo
 * y deshabilita el boton durante la espera, con cuenta regresiva.
 */
export function ResendVerificationPrompt({ email, editable = false }: ResendVerificationPromptProps) {
  const { resend, sent, isSending, emailError, cooldownSeconds, coolingDown } = useResendVerification();
  const [open, setOpen] = useState(false);
  const [draftEmail, setDraftEmail] = useState(email);
  const disabled = isSending || coolingDown;
  const confirmation = sent ? (
    <InlineAlert className="mt-3" title={GENERIC_ACCOUNT_EMAIL_MESSAGE} tone="info" />
  ) : null;

  if (!editable) {
    return (
      <div className="mt-4 text-center text-sm text-[var(--color-text-muted)]">
        <span>¿No te llegó el correo? </span>
        <button
          className="font-semibold text-[var(--color-title)] hover:underline disabled:cursor-not-allowed disabled:opacity-60 disabled:no-underline"
          disabled={disabled}
          onClick={() => void resend(email)}
          type="button"
        >
          {resendLabel("Reenviar", cooldownSeconds, isSending)}
        </button>
        {confirmation}
      </div>
    );
  }

  if (!open) {
    return (
      <p className="mt-4 text-center text-sm text-[var(--color-text-muted)]">
        ¿No te llegó el correo de verificación?{" "}
        <button
          className="font-semibold text-[var(--color-title)] hover:underline"
          onClick={() => {
            setDraftEmail(email);
            setOpen(true);
          }}
          type="button"
        >
          Reenviar
        </button>
      </p>
    );
  }

  return (
    <form
      className="mt-4 space-y-3 rounded-md border border-[var(--color-border)] p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void resend(draftEmail);
      }}
    >
      <FormField error={emailError} id="resend-verification-email" label="Correo de tu cuenta">
        <Input
          autoComplete="email"
          disabled={isSending}
          id="resend-verification-email"
          onChange={(event) => setDraftEmail(event.target.value)}
          placeholder="tu@correo.com"
          type="email"
          value={draftEmail}
        />
      </FormField>
      <Button className="w-full" disabled={disabled} type="submit" variant="secondary">
        {resendLabel("Reenviar correo", cooldownSeconds, isSending)}
      </Button>
      {confirmation}
    </form>
  );
}
