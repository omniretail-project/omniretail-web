import { cn } from "@/shared/utils/cn";

export interface DemoBannerProps {
  onReset: () => void;
  /** Enlace a "Contratar MARJYM"; si esta vacio no se muestra. */
  contractUrl?: string;
  /** Enlace opcional de contacto comercial. */
  contactUrl?: string;
  className?: string;
}

const linkClassName = "font-semibold underline underline-offset-2 hover:no-underline";

/**
 * Franja informativa de la demo publica. Puramente presentacional: el reinicio y las URLs llegan
 * por props, no conoce repositorios ni variables de entorno.
 */
export function DemoBanner({ onReset, contractUrl, contactUrl, className }: Readonly<DemoBannerProps>) {
  return (
    <section
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-[var(--color-structure)] px-4 py-2 text-sm text-white",
        className,
      )}
      aria-label="Aviso de demo"
    >
      <span>Estás en una demo con datos de ejemplo</span>
      <button className={linkClassName} onClick={onReset} type="button">
        Reiniciar demo
      </button>
      {contractUrl ? (
        <a className={linkClassName} href={contractUrl} rel="noopener noreferrer">
          Contratar MARJYM
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
