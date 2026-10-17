export function AccessDeniedState() {
  return (
    <section aria-label="Acceso denegado" className="flex min-h-[40vh] items-center justify-center px-4 py-12" role="alert">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-white p-6 text-center shadow-sm">
        <h2 className="break-words text-xl font-semibold text-[var(--color-title)]">Acceso no autorizado</h2>
        <p className="mt-2 break-words text-sm text-[var(--color-text-muted)]">
          No dispone de permisos para acceder a esta sección.
        </p>
      </div>
    </section>
  );
}
