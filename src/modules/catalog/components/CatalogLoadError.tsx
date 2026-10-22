import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";

interface CatalogLoadErrorProps {
  /** Que no se pudo cargar, p. ej. «No se pudieron cargar las categorías.». */
  title: string;
  /** Motivo seguro ya traducido para el usuario (nunca una excepcion cruda). */
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}

/**
 * Estado de ERROR de una lista del catalogo. Reemplaza a la tabla: un fallo de red, de permisos o
 * del servidor nunca debe presentarse como «no hay registros». Ofrece reintentar la consulta.
 */
export function CatalogLoadError({ title, message, onRetry, retrying = false }: CatalogLoadErrorProps) {
  return (
    <div className="border-t border-[var(--color-border)] p-4">
      <InlineAlert
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        description={message === title ? undefined : message}
        title={title}
        tone="danger"
      >
        <Button disabled={retrying} onClick={onRetry} type="button" variant="secondary">
          {retrying ? "Reintentando..." : "Reintentar"}
        </Button>
      </InlineAlert>
    </div>
  );
}
