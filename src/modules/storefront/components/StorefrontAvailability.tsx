import type { StorefrontBranchAvailabilityDto } from "@/modules/storefront/application/dto/StorefrontProductDetailDto";

export function StorefrontAvailability({
  branches,
}: {
  branches: StorefrontBranchAvailabilityDto[];
}) {
  return (
    <details
      className="group mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      open
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5">
        <span>
          <span className="block text-xl font-bold text-[var(--color-text)]">
            Disponibilidad en tiendas
          </span>
          <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
            Consulta dónde puedes encontrar este producto.
          </span>
        </span>
        <span className="rounded-full bg-[var(--color-primary)]/15 px-3 py-1 text-sm font-bold text-[var(--color-title)] group-open:hidden">
          Ver
        </span>
        <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-[var(--color-text-muted)] group-open:block">
          Ocultar
        </span>
      </summary>
      <ul className="space-y-3 border-t border-[var(--color-border)] p-5">
        {branches.map((branch) => (
          <li
            key={branch.branchId}
            className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"
          >
            <div>
              <p className="font-bold text-[var(--color-text)]">{branch.branchName}</p>
              {branch.address ? (
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{branch.address}</p>
              ) : null}
            </div>
            <span
              className={
                branch.available
                  ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800"
                  : "rounded-full bg-slate-200 px-3 py-1 text-sm font-bold text-slate-600"
              }
            >
              {branch.available ? "Disponible" : "No disponible"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
