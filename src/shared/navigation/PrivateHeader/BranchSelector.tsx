"use client";

import { useEffect, useRef, useState } from "react";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import { ChevronDownIcon, StoreIcon } from "@/shared/navigation/PrivateHeader/icons";

export function BranchSelector() {
  const { branches, currentBranch, loading, error, reload, setActiveBranchId } = useActiveBranch();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canSwitch = branches.length > 1;

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

  if (loading) {
    return (
      <div className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-2 text-sm font-semibold text-[var(--color-text-muted)] sm:px-3">
        <StoreIcon className="shrink-0" />
        Cargando sucursal
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-[var(--color-danger)] bg-white px-2 text-sm font-semibold text-[var(--color-danger)] sm:px-3"
        role="alert"
      >
        <StoreIcon className="shrink-0" />
        <span className="truncate">No se pudo cargar la sucursal</span>
        <button className="underline" onClick={() => void reload()} type="button">
          Reintentar
        </button>
      </div>
    );
  }

  if (!currentBranch) {
    return (
      <div className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-2 text-sm font-semibold text-[var(--color-text-muted)] sm:px-3">
        <StoreIcon className="shrink-0" />
        Sin sucursales
      </div>
    );
  }

  if (!canSwitch) {
    return (
      <div className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-2 text-sm font-semibold text-[var(--color-title)] sm:max-w-[220px] sm:px-3">
        <StoreIcon className="shrink-0" />
        <span className="truncate">{currentBranch.name}</span>
      </div>
    );
  }

  return (
    <div className="relative max-w-full" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-2 text-sm font-semibold text-[var(--color-title)] transition hover:border-[var(--color-structure)] hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] sm:max-w-[240px] sm:px-3"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <StoreIcon className="shrink-0" />
        <span className="truncate">{currentBranch.name}</span>
        <ChevronDownIcon className="shrink-0" />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-11 z-50 max-h-[min(24rem,70dvh)] w-[min(16rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-white py-2 shadow-lg"
          role="listbox"
        >
          {branches.map((branch) => (
            <button
              aria-selected={branch.id === currentBranch.id}
              className="block w-full px-4 py-2.5 text-left text-sm font-semibold text-[var(--color-text)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-structure)]"
              key={branch.id}
              onClick={() => {
                setActiveBranchId(branch.id);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              {branch.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
