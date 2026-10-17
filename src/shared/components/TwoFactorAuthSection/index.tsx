"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { MfaMethod } from "@/core/entities";
import type { BeginMfaEnrollmentResult } from "@/core/repositories/AuthRepository";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { ShieldIcon } from "@/shared/components/icons";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { PasswordInput } from "@/shared/components/PasswordInput";
import { Select } from "@/shared/components/Select";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { useCooldown } from "@/shared/hooks/useCooldown";

/** Espera entre correos con codigo (la misma que aplica el backend). */
const RESEND_COOLDOWN_SECONDS = 60;

export interface TwoFactorAuthSectionProps {
  status: { enabled: boolean; method: MfaMethod } | null;
  loading: boolean;
  busy: boolean;
  onBegin: (method: MfaMethod) => Promise<BeginMfaEnrollmentResult>;
  onVerify: (code: string) => Promise<{ recoveryCodes: string[] }>;
  onDisable: (currentPassword: string) => Promise<void>;
  /** Metodos que se muestran deshabilitados como "Próximamente" (lo decide el modulo que lo usa). */
  unavailableMethods?: readonly MfaMethod[];
}

type WizardStep =
  | { name: "idle" }
  | { name: "choose-method" }
  | ({ name: "confirm-code"; method: MfaMethod } & BeginMfaEnrollmentResult)
  | { name: "recovery-codes"; codes: string[] };

const METHOD_LABELS: Record<MfaMethod, string> = {
  totp: "Aplicación de autenticación (TOTP)",
  email: "Correo electrónico",
};

/**
 * QR del `otpauth://` generado SOLO en el navegador (libreria local): el secreto nunca se envia a
 * un servicio externo, ni se guarda o se registra.
 */
function EnrollmentQrCode({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(uri, { margin: 1, width: 192 })
      .then((dataUrl) => {
        if (active) setSrc(dataUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [uri]);

  if (failed) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        No se pudo generar el código QR. Ingresa la clave manualmente.
      </p>
    );
  }
  if (!src) {
    return <div aria-hidden="true" className="h-48 w-48 rounded-md bg-[var(--color-app-background)]" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- data URL generado en el navegador.
  return <img alt="Código QR para la app autenticadora" className="h-48 w-48 rounded-md border border-[var(--color-border)] bg-white" src={src} />;
}

/**
 * Componente puramente presentacional (sin repositorios ni sesión propia,
 * ver docs/AI_CONTEXT.md "Shared no contiene logica de negocio") --
 * modules/customer/pages/SeguridadPage.tsx y
 * modules/auth/pages/EmployeeSeguridadPage.tsx lo usan cada uno con su
 * propio hook (useMfaEnrollment), pasando las mismas acciones por props.
 * Mismo criterio que PrivateShell/CustomerAccountShell: un solo bloque
 * visual, cero acoplamiento entre módulos.
 */
export function TwoFactorAuthSection({
  status,
  loading,
  busy,
  onBegin,
  onVerify,
  onDisable,
  unavailableMethods = [],
}: TwoFactorAuthSectionProps) {
  const [step, setStep] = useState<WizardStep>({ name: "idle" });
  const [method, setMethod] = useState<MfaMethod>("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [disablePasswordOpen, setDisablePasswordOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | undefined>();
  const {
    remaining: resendCooldownSeconds,
    start: startResendCooldown,
    reset: resetResendCooldown,
  } = useCooldown(RESEND_COOLDOWN_SECONDS);

  async function handleBegin() {
    setError(undefined);
    try {
      const enrollment = await onBegin(method);
      setStep({ name: "confirm-code", method, ...enrollment });
      setCode("");
      // Con correo el codigo ya se envio: "Reenviar" espera 60 s.
      if (method === "email") startResendCooldown();
      else resetResendCooldown();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo iniciar la activación.");
    }
  }

  /** Con correo, repetir la activacion reenvia el codigo (el anterior deja de servir). */
  async function handleResend() {
    if (step.name !== "confirm-code") return;
    setError(undefined);
    try {
      const enrollment = await onBegin(step.method);
      setStep({ name: "confirm-code", method: step.method, ...enrollment });
      startResendCooldown();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo reenviar el código.");
    }
  }

  async function handleVerify() {
    setError(undefined);
    try {
      const { recoveryCodes } = await onVerify(code.trim());
      setStep({ name: "recovery-codes", codes: recoveryCodes });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo confirmar el código.");
    }
  }

  async function handleDisable() {
    setDisableError(undefined);
    try {
      await onDisable(disablePassword);
      setDisablePasswordOpen(false);
      setDisablePassword("");
    } catch (caughtError) {
      setDisableError(
        caughtError instanceof Error ? caughtError.message : "No se pudo desactivar.",
      );
    }
  }

  if (loading) {
    return (
      <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <p className="text-sm text-[var(--color-text-muted)]">Cargando verificación en dos pasos...</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-structure)]"
          >
            <ShieldIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-[var(--color-title)]">Verificación en dos pasos</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Agrega un segundo paso al iniciar sesión, además de tu contraseña.
            </p>
          </div>
        </div>
        <StatusBadge
          status={status?.enabled ? "Activado" : "Desactivado"}
          tone={status?.enabled ? "success" : "neutral"}
        />
      </div>

      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}

      {status?.enabled ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text)]">
            Activa, método: <strong>{METHOD_LABELS[status.method]}</strong>.
          </p>
          <Button
            disabled={busy}
            onClick={() => setDisablePasswordOpen(true)}
            type="button"
            variant="danger"
          >
            Desactivar
          </Button>
        </div>
      ) : step.name === "idle" ? (
        <Button disabled={busy} onClick={() => setStep({ name: "choose-method" })} type="button">
          Activar
        </Button>
      ) : step.name === "choose-method" ? (
        <div className="space-y-3">
          <FormField id="mfa-method" label="Método">
            <Select
              disabled={busy}
              id="mfa-method"
              onChange={(event) => setMethod(event.target.value as MfaMethod)}
              value={method}
            >
              {(["totp", "email"] as const).map((option) =>
                unavailableMethods.includes(option) ? (
                  <option disabled key={option} value={option}>
                    {METHOD_LABELS[option]} (Próximamente)
                  </option>
                ) : (
                  <option key={option} value={option}>
                    {METHOD_LABELS[option]}
                  </option>
                ),
              )}
            </Select>
          </FormField>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void handleBegin()} type="button">
              {busy ? "Generando..." : "Continuar"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => setStep({ name: "idle" })}
              type="button"
              variant="secondary"
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : step.name === "confirm-code" ? (
        <div className="space-y-3">
          {step.otpauthUri ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-text)]">
                Escanea este código QR con tu app autenticadora (por ejemplo, Google Authenticator) y
                escribe el código de 6 dígitos que te muestra.
              </p>
              <EnrollmentQrCode key={step.otpauthUri} uri={step.otpauthUri} />
              {step.secret ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  ¿No puedes escanearlo? Ingresa esta clave en la app:{" "}
                  <strong className="break-all font-mono text-[var(--color-text)]">{step.secret}</strong>
                </p>
              ) : null}
            </div>
          ) : null}
          {step.method === "email" ? (
            <p className="text-sm text-[var(--color-text)]">Te enviamos un código a tu correo.</p>
          ) : null}
          {/* Solo existe porque este entorno de demostración no tiene un
              canal real de entrega -- nunca existiría en producción.
              Mismo criterio de transparencia dummy que el resto del
              sistema. En modo api no viene. */}
          {step.demoCodeMock ? (
            <p className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
              Código de verificación actual: <strong>{step.demoCodeMock}</strong>
            </p>
          ) : null}
          <FormField id="mfa-confirm-code" label="Código de confirmación">
            <Input
              disabled={busy}
              id="mfa-confirm-code"
              inputMode="numeric"
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              value={code}
            />
          </FormField>
          <div className="flex gap-2">
            <Button disabled={busy || !code.trim()} onClick={() => void handleVerify()} type="button">
              {busy ? "Confirmando..." : "Confirmar"}
            </Button>
            {step.method === "email" ? (
              <Button
                disabled={busy || resendCooldownSeconds > 0}
                onClick={() => void handleResend()}
                type="button"
                variant="secondary"
              >
                {resendCooldownSeconds > 0
                  ? `Reenviar código (${resendCooldownSeconds} s)`
                  : "Reenviar código"}
              </Button>
            ) : null}
            <Button
              disabled={busy}
              onClick={() => setStep({ name: "idle" })}
              type="button"
              variant="secondary"
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      <Modal
        onClose={() => setStep({ name: "idle" })}
        open={step.name === "recovery-codes"}
        title="Guarda tus códigos de recuperación"
      >
        <p className="text-sm text-[var(--color-text-muted)]">
          Cada código sirve una sola vez y no se vuelven a mostrar. Guárdalos en un lugar seguro.
        </p>
        {step.name === "recovery-codes" ? (
          <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm">
            {step.codes.map((recoveryCode) => (
              <li
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2 text-center"
                key={recoveryCode}
              >
                {recoveryCode}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-6 flex justify-end">
          <Button onClick={() => setStep({ name: "idle" })} type="button">
            Ya los guardé
          </Button>
        </div>
      </Modal>

      <Modal
        onClose={() => {
          setDisablePasswordOpen(false);
          setDisablePassword("");
          setDisableError(undefined);
        }}
        open={disablePasswordOpen}
        title="Desactivar verificación en dos pasos"
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            Confirma tu contraseña actual para desactivarla.
          </p>
          {disableError ? <p className="text-sm text-[var(--color-danger)]">{disableError}</p> : null}
          <FormField id="mfa-disable-password" label="Contraseña actual">
            <PasswordInput
              autoComplete="current-password"
              disabled={busy}
              id="mfa-disable-password"
              onChange={(event) => setDisablePassword(event.target.value)}
              value={disablePassword}
            />
          </FormField>
          <Button disabled={busy || !disablePassword} onClick={() => void handleDisable()} type="button" variant="danger">
            {busy ? "Desactivando..." : "Desactivar"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
