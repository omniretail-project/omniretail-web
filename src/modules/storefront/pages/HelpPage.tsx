"use client";

import { useEffect, useState } from "react";
import { BranchType } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

interface ContactData {
  phone?: string;
  email?: string;
  branchCount: number;
}

export function HelpPage() {
  const repositories = useRepositories();
  const { tenantId, loading: tenantLoading } = usePublicTenant();
  const [contact, setContact] = useState<ContactData | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!tenantId) {
        if (active) setContact(null);
        return;
      }
      const branches = (await repositories.branches.getActive()).filter(
        (branch) => branch.tenantId === tenantId && branch.type === BranchType.store,
      );
      if (!active) return;
      setContact({
        phone: branches.find((branch) => branch.phone)?.phone,
        email: branches.find((branch) => branch.email)?.email,
        branchCount: branches.length,
      });
    };
    if (!tenantLoading) void load();
    return () => {
      active = false;
    };
  }, [repositories.branches, tenantId, tenantLoading]);

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
          detail={contact?.phone ?? "Información aún no configurada"}
          icon="☎"
          loading={tenantLoading || contact === null}
          title="Línea de contacto"
        />
        <ContactCard
          detail={contact?.email ?? "Información aún no configurada"}
          icon="✉"
          loading={tenantLoading || contact === null}
          title="Correo electrónico"
        />
        <ContactCard
          detail={
            contact
              ? `${contact.branchCount} ${contact.branchCount === 1 ? "sucursal activa" : "sucursales activas"}`
              : "Información aún no configurada"
          }
          icon="⌂"
          loading={tenantLoading || contact === null}
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
