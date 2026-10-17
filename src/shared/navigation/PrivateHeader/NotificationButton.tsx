"use client";

import { useEffect, useRef, useState } from "react";
import { BellIcon } from "@/shared/navigation/PrivateHeader/icons";

export function NotificationButton() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Notificaciones"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-white text-[var(--color-title)] transition hover:border-[var(--color-structure)] hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <BellIcon />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-11 z-30 w-72 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-lg"
          role="dialog"
        >
          <p className="text-sm font-bold text-[var(--color-title)]">Notificaciones</p>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">No hay notificaciones.</p>
        </div>
      ) : null}
    </div>
  );
}
