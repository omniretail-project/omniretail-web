"use client";

import Link from "next/link";
import { useRequestPasswordReset } from "@/modules/auth/hooks/useRequestPasswordReset";
import { BrandMark } from "@/shared/components/BrandMark";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { GENERIC_RECOVERY_MESSAGE, PASSWORD_RESET_TOKEN_MINUTES } from "@/config/auth-policy";
import { useOptionalStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";

export function RequestPasswordResetPage() {
  const { email, setEmail, fieldErrors, isSubmitting, completed, submit } =
    useRequestPasswordReset();
  const storefrontRoutes = useOptionalStorefrontRoutes();
  const loginHref = storefrontRoutes ? storefrontRoutes.login() : "/iniciar-sesion";

  if (completed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-app-background)] px-6 py-10">
        <section className="w-full max-w-md rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <BrandMark className="justify-center" />
          <h1 className="mt-2 text-2xl font-bold text-[var(--color-title)]">Revisa tu correo</h1>
          <InlineAlert className="mt-4 text-left" title={GENERIC_RECOVERY_MESSAGE} tone="info" />
          <ol className="mt-4 space-y-2 text-left text-sm text-[var(--color-text)]">
            <li>
              <span className="font-semibold">Paso 1.</span> Abre la bandeja de entrada del correo
              asociado a tu cuenta.
            </li>
            <li>
              <span className="font-semibold">Paso 2.</span> Busca el correo de MARJYM y haz clic
              en el enlace de recuperación que contiene.
            </li>
            <li>
              <span className="font-semibold">Paso 3.</span> Ese enlace te llevará directo a una
              pantalla para elegir tu nueva contraseña -- no necesitas copiar ningún código
              manualmente.
            </li>
          </ol>
          <p className="mt-4 text-left text-xs text-[var(--color-text-muted)]">
            El enlace es válido por {PASSWORD_RESET_TOKEN_MINUTES} minutos. Si no llega ningún
            correo, revisa spam o solicita uno nuevo.
          </p>
          <p className="mt-6 text-sm text-[var(--color-text-muted)]">
            <Link
              className="font-semibold text-[var(--color-title)] hover:underline"
              href={loginHref}
            >
              Volver a iniciar sesión
            </Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-app-background)] px-6 py-10">
      <section className="w-full max-w-md rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <BrandMark />
        <h1 className="mt-2 text-2xl font-bold text-[var(--color-title)]">
          Recupera tu contraseña
        </h1>
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Escribe tu correo y te enviaremos instrucciones para restablecer tu contraseña.
        </p>

        <form
          className="mt-6 space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FormField error={fieldErrors.email} id="recover-email" label="Correo electronico">
            <Input
              autoComplete="email"
              disabled={isSubmitting}
              id="recover-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tu@correo.com"
              type="email"
              value={email}
            />
          </FormField>

          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Enviando..." : "Enviar instrucciones"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
          <Link
            className="font-semibold text-[var(--color-title)] hover:underline"
            href={loginHref}
          >
            Volver a iniciar sesión
          </Link>
        </p>
      </section>
    </main>
  );
}
