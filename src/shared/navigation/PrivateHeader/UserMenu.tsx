"use client";

import { useEffect, useRef, useState } from "react";
import { UserIcon } from "@/shared/navigation/PrivateHeader/icons";

export interface UserMenuProps {
  description?: string;
  label?: string;
  onLogout?: () => void;
}

export function UserMenu({ description, label, onLogout }: UserMenuProps) {
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
        aria-label="Cuenta de usuario"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-app-background)] text-[var(--color-title)] transition hover:border-[var(--color-structure)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <UserIcon />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-lg"
          role="dialog"
        >
          <p className="truncate text-sm font-bold text-[var(--color-title)]">
            {label ?? "Cuenta"}
          </p>
          {description ? (
            <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">{description}</p>
          ) : null}
          {onLogout ? (
            <button
              className="mt-3 w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-left text-sm font-semibold text-[var(--color-danger)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              type="button"
            >
              Cerrar sesión
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
