"use client";

import Link from "next/link";
import { useVerifyEmail } from "@/modules/auth/hooks/useVerifyEmail";
import { BrandMark } from "@/shared/components/BrandMark";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";

export function VerifyEmailPage({ token }: { token: string }) {
  const { state, tenantSlug } = useVerifyEmail(token);
  const loginUrl = tenantSlug ? `/tienda/${encodeURIComponent(tenantSlug)}/iniciar-sesion` : "/iniciar-sesion";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-app-background)] px-6 py-10">
      <section className="w-full max-w-md rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
        <BrandMark className="justify-center" />

        {state === "loading" ? (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">Verificando tu cuenta...</p>
        ) : null}

        {state === "success" ? (
          <>
            <h1 className="mt-2 text-2xl font-bold text-[var(--color-title)]">Cuenta verificada</h1>
            <InlineAlert
              className="mt-4 text-left"
              title="Tu cuenta quedó activa."
              tone="success"
            />
            <Button className="mt-6 w-full" href={loginUrl}>
              Iniciar sesión
            </Button>
          </>
        ) : null}

        {state === "error" ? (
          <>
            <h1 className="mt-2 text-2xl font-bold text-[var(--color-title)]">
              No pudimos verificar tu cuenta
            </h1>
            <InlineAlert
              className="mt-4 text-left"
              title="Este enlace no es válido."
              description="Puede que ya esté verificada o que haya expirado. Intenta iniciar sesión."
              tone="danger"
            />
            <p className="mt-6 text-sm text-[var(--color-text-muted)]">
              <Link
                className="font-semibold text-[var(--color-title)] hover:underline"
                href="/iniciar-sesion"
              >
                Ir a iniciar sesión
              </Link>
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
