"use client";

import Link from "next/link";
import { EMPLOYEE_PASSWORD_POLICY, getPasswordRequirementsMessage } from "@/config/auth-policy";
import { useActivateAccount } from "@/modules/auth/hooks/useActivateAccount";
import { BrandMark } from "@/shared/components/BrandMark";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PasswordInput } from "@/shared/components/PasswordInput";

const employeePasswordHint = getPasswordRequirementsMessage(EMPLOYEE_PASSWORD_POLICY);

export function ActivateAccountPage({ token }: { token: string }) {
  const {
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    fieldErrors,
    formError,
    isSubmitting,
    completed,
    submit,
  } = useActivateAccount(token);

  if (completed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-app-background)] px-6 py-10">
        <section className="w-full max-w-md rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <BrandMark className="justify-center" />
          <h1 className="mt-2 text-2xl font-bold text-[var(--color-title)]">Cuenta activada</h1>
          <InlineAlert
            className="mt-4 text-left"
            title="Ya puedes iniciar sesión con tu nueva contraseña."
            tone="success"
          />
          <Button className="mt-6 w-full" href="/iniciar-sesion">
            Iniciar sesión
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-app-background)] px-6 py-10">
      <section className="w-full max-w-md rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <BrandMark />
        <h1 className="mt-2 text-2xl font-bold text-[var(--color-title)]">Activa tu cuenta</h1>
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Establece tu contraseña para completar la activación de tu cuenta de personal.
        </p>

        <form
          className="mt-6 space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {formError ? <InlineAlert title={formError} tone="danger" /> : null}

          <FormField
            error={fieldErrors.password}
            hint={employeePasswordHint}
            id="activate-password"
            label="Contraseña"
          >
            <PasswordInput
              autoComplete="new-password"
              disabled={isSubmitting}
              id="activate-password"
              maxLength={EMPLOYEE_PASSWORD_POLICY.MAX_LENGTH}
              onChange={(event) => setPassword(event.target.value)}
              value={password}
            />
          </FormField>

          <FormField
            error={fieldErrors.confirmPassword}
            id="activate-confirm-password"
            label="Confirmar contraseña"
          >
            <PasswordInput
              autoComplete="new-password"
              disabled={isSubmitting}
              id="activate-confirm-password"
              maxLength={EMPLOYEE_PASSWORD_POLICY.MAX_LENGTH}
              onChange={(event) => setConfirmPassword(event.target.value)}
              value={confirmPassword}
            />
          </FormField>

          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Activando..." : "Activar cuenta"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
          <Link
            className="font-semibold text-[var(--color-title)] hover:underline"
            href="/iniciar-sesion"
          >
            Volver a iniciar sesión
          </Link>
        </p>
      </section>
    </main>
  );
}
