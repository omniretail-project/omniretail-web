"use client";

import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

export function BranchesPage() {
  const { config, loading } = usePublicTenant();
  const branches = config?.branches ?? [];

  return (
    <main className="mx-auto max-w-6xl px-5 py-12">
      <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <div className="bg-[var(--color-topbar)] px-6 py-7 text-white sm:px-8">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-primary)]/20 text-xl">
              ▥
            </span>
            <div>
              <h1 className="text-2xl font-black">Nuestras sucursales</h1>
              <p className="mt-1 text-sm text-slate-300">
                Consulta las tiendas activas y su información de contacto.
              </p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-7">
          {loading ? (
            <p className="text-center text-[var(--color-text-muted)]">Cargando sucursales...</p>
          ) : branches.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center text-[var(--color-text-muted)]">
              No hay sucursales tipo tienda activas disponibles.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {branches.map((branch) => (
                <article
                  className="rounded-xl border border-[var(--color-border)] bg-slate-50 p-5"
                  key={branch.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--color-title)]">⌖</span>
                      <h2 className="font-black text-[var(--color-text)]">{branch.name}</h2>
                    </div>
                    {branch.code ? (
                      <span className="rounded bg-[var(--color-primary)]/15 px-2 py-1 text-xs font-black text-[var(--color-title)]">
                        {branch.code}
                      </span>
                    ) : null}
                  </div>
                  {branch.address ? (
                    <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                      {branch.address}
                    </p>
                  ) : null}
                  <div className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-4 text-sm">
                    {branch.phone ? (
                      <p className="text-[var(--color-text-muted)]">☎ {branch.phone}</p>
                    ) : null}
                    {branch.email ? (
                      <p className="break-words text-[var(--color-text-muted)]">✉ {branch.email}</p>
                    ) : null}
                    {!branch.phone && !branch.email ? (
                      <p className="text-[var(--color-text-muted)]">
                        Información de contacto aún no configurada.
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
