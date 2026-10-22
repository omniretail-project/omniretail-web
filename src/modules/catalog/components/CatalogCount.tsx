interface CatalogCountProps {
  /** `null` = el backend no entrego el dato: se informa como no disponible, nunca como cero. */
  value: number | null;
  /** El listado se esta recargando: el valor anterior ya no es confiable. */
  loading?: boolean;
}

/**
 * Conteo de productos de categorias y ubicaciones con tres estados distintos: conocido (incluido el
 * cero real), cargando y no disponible. Un dato desconocido jamas se muestra como 0 ni como guion.
 */
export function CatalogCount({ value, loading = false }: CatalogCountProps) {
  if (loading) {
    return (
      <span
        aria-busy="true"
        aria-label="Cargando conteo"
        className="font-semibold text-[var(--color-text-muted)]"
      >
        …
      </span>
    );
  }
  if (value === null) {
    return (
      <span
        className="text-xs font-semibold text-[var(--color-text-muted)]"
        title="El conteo no está disponible en este momento."
      >
        No disponible
      </span>
    );
  }
  return <>{value}</>;
}
