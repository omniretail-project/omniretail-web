"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

export interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
  maxWidth?: CSSProperties["maxWidth"];
  density?: "default" | "compact";
}

const sizeClassNames: Record<NonNullable<ModalProps["size"]>, string> = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({
  open,
  title,
  subtitle,
  children,
  onClose,
  footer,
  size = "md",
  maxWidth,
  density = "default",
}: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.queueMicrotask(() => dialogRef.current?.focus());

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-topbar)]/35 p-3 sm:p-6"
      role="presentation"
    >
      <button aria-label="Cerrar" className="absolute inset-0" onClick={onClose} type="button" />
      <section
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "relative flex max-h-[90dvh] w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-xl sm:w-[calc(100vw-3rem)]",
          sizeClassNames[size],
        )}
        role="dialog"
        ref={dialogRef}
        style={maxWidth ? { maxWidth } : undefined}
        tabIndex={-1}
      >
        <header
          className={cn(
            "flex items-start justify-between gap-4 border-b border-[var(--color-structure)] bg-[var(--color-structure)]",
            density === "compact" ? "px-4 py-3" : "px-5 py-4",
          )}
        >
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white" id={titleId}>{title}</h2>
            {subtitle ? <p className="mt-1 break-words text-sm text-white/75" id={subtitleId}>{subtitle}</p> : null}
          </div>
          <button
            aria-label="Cerrar"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/10 text-lg font-bold text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
            density === "compact" ? "p-3 sm:p-4" : "px-4 py-4 sm:px-5",
          )}
        >
          {children}
        </div>
        {footer ? (
          <footer className="shrink-0 border-t border-[var(--color-border)] bg-white px-4 py-4 sm:px-5">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>
  );
}
