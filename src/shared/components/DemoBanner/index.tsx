import { cn } from "@/shared/utils/cn";

export interface DemoBannerProps {
  onReset: () => void;
  /** Reinicio en curso: deshabilita el boton para no lanzarlo dos veces. */
  resetting?: boolean;
  /** Enlace a "Solicitar informacion" (landing real); si esta vacio no se muestra. */
  informationRequestUrl?: string;
  /** Enlace opcional de contacto comercial. */
  contactUrl?: string;
  className?: string;
}

const linkClassName = "font-semibold underline underline-offset-2 hover:no-underline";

/**
 * Franja informativa de la demo publica. Puramente presentacional: el reinicio y las URLs llegan
 * por props, no conoce repositorios ni variables de entorno.
 */
export function DemoBanner({
  onReset,
  resetting = false,
  informationRequestUrl,
  contactUrl,
  className,
}: Readonly<DemoBannerProps>) {
  return (
    <section
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-[var(--color-structure)] px-4 py-2 text-sm text-white",
        className,
      )}
      aria-label="Aviso de demo"
    >
      <span>Estás en una demo con datos de ejemplo</span>
      <button
        className={cn(linkClassName, "disabled:cursor-wait disabled:opacity-70")}
        disabled={resetting}
        onClick={onReset}
        type="button"
      >
        {resetting ? "Reiniciando…" : "Reiniciar demo"}
      </button>
      {informationRequestUrl ? (
        <a className={linkClassName} href={informationRequestUrl} rel="noopener noreferrer">
          Solicitar información
        </a>
      ) : null}
      {contactUrl ? (
        <a className={linkClassName} href={contactUrl} rel="noopener noreferrer" target="_blank">
          ¿Quieres que te contactemos?
        </a>
      ) : null}
    </section>
  );
}
