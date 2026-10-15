import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

export interface DemoUnavailableNoticeProps {
  title?: string;
  description?: string;
  /** Contenido opcional, p.ej. un enlace de regreso. */
  children?: ReactNode;
  className?: string;
}

/**
 * Aviso presentacional para funciones que la demo publica no ofrece. No decide cuando mostrarse:
 * quien lo renderiza evalua la bandera de demo.
 */
export function DemoUnavailableNotice({
  title = "No disponible en la demo",
  description,
  children,
  className,
}: DemoUnavailableNoticeProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm shadow-sm",
        className,
      )}
    >
      <p className="font-semibold text-[var(--color-title)]">{title}</p>
      {description ? <p className="mt-1 text-[var(--color-text-muted)]">{description}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}
