"use client";

import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

const NOT_CONFIGURED = "Información aún no configurada";

/**
 * Contacto de la tienda: el teléfono y correo públicos de la configuración de e-commerce y las
 * sucursales de la config pública, la misma fuente que Soporte. No consulta repositorios: para
 * clientes e invitados esos solo llegan al backend con sesión de empleado.
 */
export function HelpPage() {
  const { config, loading } = usePublicTenant();
  const branchCount = config?.branches.length ?? 0;
  const branchLabel = branchCount === 1 ? "sucursal activa" : "sucursales activas";
  const branchDetail = config ? `${branchCount} ${branchLabel}` : NOT_CONFIGURED;

  return (
    <main className="mx-auto max-w-6xl px-5 py-12">
      <section className="rounded-3xl bg-[var(--color-topbar)] px-6 py-10 text-white md:px-10">
        <p className="text-sm font-bold uppercase tracking-[.2em] text-[var(--color-primary)]">
          Estamos para ayudarte
        </p>
        <h1 className="mt-3 text-4xl font-black">Ayuda de compra</h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-300">
          Conoce los medios de contacto y las sucursales disponibles del negocio.
        </p>
      </section>

      <section className="mt-8 grid gap-5 md:grid-cols-3">
        <ContactCard
          detail={config?.contactPhone?.trim() || NOT_CONFIGURED}
          icon="☎"
          loading={loading}
          title="Línea de contacto"
        />
        <ContactCard
          detail={config?.contactEmail?.trim() || NOT_CONFIGURED}
          icon="✉"
          loading={loading}
          title="Correo electrónico"
        />
        <ContactCard
          detail={branchDetail}
          icon="⌂"
          loading={loading}
          title="Sucursales físicas"
        />
      </section>
    </main>
  );
}

function ContactCard({
  icon,
  title,
  detail,
  loading,
}: {
  icon: string;
  title: string;
  detail: string;
  loading: boolean;
}) {
  return (
    <section className="min-h-44 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center shadow-sm">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--color-primary)]/15 text-xl font-black text-[var(--color-title)]">
        {icon}
      </span>
      <h2 className="mt-4 font-black text-[var(--color-text)]">{title}</h2>
      <p className="mt-3 break-words text-sm font-semibold text-[var(--color-title)]">
        {loading ? "Cargando información..." : detail}
      </p>
    </section>
  );
}
