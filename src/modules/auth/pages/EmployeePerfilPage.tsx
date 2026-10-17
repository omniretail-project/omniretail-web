"use client";

import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { PageHeader } from "@/shared/components/PageHeader";

function getInitials(name: string | undefined): string {
  return name
    ?.trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

/**
 * Perfil de Employee/Admin: solo lectura, estatico -- a diferencia del
 * Perfil de Customer (editable), acá se pidió explícitamente que no se
 * pueda modificar. Muestra los mismos datos con los que se creó la
 * cuenta (User.name/email/phone/employeeCode), sin ningún formulario ni
 * acción de edición.
 */
export function EmployeePerfilPage() {
  const { user, role } = useCurrentSession();

  const fields = [
    { label: "Nombre completo", value: user?.name },
    { label: "Correo electrónico", value: user?.email },
    { label: "Teléfono", value: user?.phone || "No registrado" },
    { label: "Código de empleado", value: user?.employeeCode || "No asignado" },
    { label: "Rol", value: role?.name },
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-5">
      <PageHeader
        description="Datos con los que se creó tu cuenta. Esta información es de solo lectura."
        title="Datos personales"
      />

      <section className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-slate-50 p-5 sm:flex-row sm:items-center">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--color-structure)] text-lg font-bold text-white"
        >
          {getInitials(user?.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Perfil interno
          </p>
          <h2 className="mt-1 truncate text-xl font-bold text-[var(--color-text)]">
            {user?.name ?? "Usuario"}
          </h2>
          <p className="mt-1 truncate text-sm text-[var(--color-text-muted)]">{user?.email}</p>
        </div>
        {role?.name ? (
          <span className="w-fit rounded-full bg-[var(--color-primary)]/20 px-3 py-1 text-xs font-bold text-[var(--color-title)]">
            {role.name}
          </span>
        ) : null}
      </section>

      <dl className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm sm:grid-cols-2 sm:p-6">
        {fields.map((field) => (
          <div className="rounded-lg bg-slate-50 p-4" key={field.label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{field.label}</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{field.value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
