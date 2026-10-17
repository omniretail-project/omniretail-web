import { Button } from "@/shared/components/Button";

interface PageErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function PageErrorState({
  title = "No fue posible cargar esta sección",
  description = "Intente nuevamente en unos momentos.",
  onRetry,
}: PageErrorStateProps) {
  return (
    <section aria-label="Error de página" className="flex min-h-[40vh] items-center justify-center px-4 py-12" role="alert">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-white p-6 text-center shadow-sm">
        <h2 className="break-words text-xl font-semibold text-[var(--color-title)]">{title}</h2>
        <p className="mt-2 break-words text-sm text-[var(--color-text-muted)]">{description}</p>
        {onRetry ? <Button className="mt-6" onClick={onRetry} type="button">Reintentar</Button> : null}
      </div>
    </section>
  );
}
