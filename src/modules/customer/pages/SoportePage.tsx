"use client";

import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { PageHeader } from "@/shared/components/PageHeader";
import { MailIcon, PhoneIcon } from "@/shared/components/icons";

const FIELDS = [
  { key: "contactEmail", label: "Correo electrónico", href: (value: string) => `mailto:${value}`, cta: "Enviar correo", Icon: MailIcon },
  { key: "contactPhone", label: "Teléfono", href: (value: string) => `tel:${value}`, cta: "Llamar", Icon: PhoneIcon },
] as const;

/**
 * Solo lectura, sin llamadas a ningun repositorio propio -- reutiliza
 * PublicTenantProvider (misma fuente que el resto del Storefront publico,
 * ver PR "storefront-public-config-contracts") para leer
 * EcommerceConfig.contactEmail/contactPhone. No existe una fuente de
 * contacto separada para Soporte: si el negocio actualiza su contacto
 * publico desde Administracion > Ecommerce, esta pantalla lo refleja
 * automaticamente sin necesitar un cambio de codigo aparte.
 *
 * Cada campo puede venir `undefined` (sin dato real definido todavia): se
 * omite en vez de mostrar un placeholder que aparente ser un contacto
 * real. Si ningun campo tiene dato, se muestra un mensaje neutro.
 */
export function SoportePage() {
  const { config, loading } = usePublicTenant();

  const visibleFields = FIELDS.filter((field) => Boolean(config?.[field.key]));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader description="¿Necesitas ayuda? Contáctanos por estos medios." title="Soporte" />

      {loading ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-text-muted)] shadow-sm">
          Cargando información de contacto...
        </div>
      ) : visibleFields.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-text-muted)] shadow-sm">
          Información de contacto no disponible por el momento.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visibleFields.map(({ key, label, href, cta, Icon }) => {
            const value = config?.[key] as string;
            return (
              <article
                className="flex h-full flex-col items-start gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm"
                key={key}
              >
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)]/10 text-[var(--color-structure)]"
                >
                  <Icon className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
                  <p className="mt-1 break-words font-semibold text-[var(--color-text)]">{value}</p>
                </div>
                <a
                  className="mt-auto inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-semibold text-[var(--color-title)] transition hover:bg-[var(--color-app-background)]"
                  href={href(value)}
                >
                  {cta}
                </a>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
