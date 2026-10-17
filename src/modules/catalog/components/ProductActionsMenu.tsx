"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ProductStatus } from "@/core/enums";
import {
  ArchiveIcon,
  CheckIcon,
  HistoryIcon,
  TagIcon,
} from "@/modules/catalog/components/CatalogIcons";
import type { ProductListItem } from "@/modules/catalog/types/catalog.types";
import { cn } from "@/shared/utils/cn";

interface ProductActionsMenuProps {
  canUpdate: boolean;
  priceHistoryEnabled: boolean;
  promotionsEnabled: boolean;
  product: ProductListItem;
  onPromotion: (product: ProductListItem) => void;
  onPriceHistory: (product: ProductListItem) => void;
  onArchive: (product: ProductListItem) => void;
  onRestore: (product: ProductListItem) => void;
}

export function ProductActionsMenu({
  canUpdate,
  priceHistoryEnabled,
  promotionsEnabled,
  product,
  onPromotion,
  onPriceHistory,
  onArchive,
  onRestore,
}: ProductActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function updateMenuPosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const actionCount =
        (promotionsEnabled && product.status === ProductStatus.published ? 1 : 0) +
        (priceHistoryEnabled ? 1 : 0) +
        (canUpdate ? 1 : 0);
      const menuHeight = actionCount * 44 + 16;
      const spaceBelow = window.innerHeight - rect.bottom;
      const shouldOpenUp = spaceBelow < menuHeight + 12 && rect.top > spaceBelow;
      setMenuStyle({
        right: Math.max(12, window.innerWidth - rect.right),
        top: shouldOpenUp
          ? Math.max(12, rect.top - menuHeight - 6)
          : Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 12),
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [canUpdate, open, priceHistoryEnabled, product.status, promotionsEnabled]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node) || !containerRef.current?.contains(target)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("click", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectAction(action: (product: ProductListItem) => void) {
    setOpen(false);
    action(product);
  }

  if (!canUpdate && !priceHistoryEnabled && !promotionsEnabled) return null;

  return (
    <div
      className="relative flex justify-end"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      ref={containerRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Acciones de ${product.name}`}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-md border bg-white text-xl font-bold leading-none text-[var(--color-title)] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
          open
            ? "border-[var(--color-structure)] bg-[var(--color-primary)]/10"
            : "border-[var(--color-border)] hover:border-[var(--color-structure)] hover:bg-[var(--color-app-background)]",
        )}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        ref={buttonRef}
        type="button"
      >
        ⋮
      </button>
      {open ? (
        <div
          className="fixed z-50 w-[min(15rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--color-border)] bg-white py-2 shadow-lg"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="menu"
          style={menuStyle}
        >
          {promotionsEnabled && product.status === ProductStatus.published ? (
            <MenuItem icon={<TagIcon />} onClick={() => selectAction(onPromotion)}>
              Promoción
            </MenuItem>
          ) : null}
          {priceHistoryEnabled ? (
            <MenuItem icon={<HistoryIcon />} onClick={() => selectAction(onPriceHistory)}>
              Historial de precios
            </MenuItem>
          ) : null}
          {canUpdate ? (
            product.status === ProductStatus.published ? (
              <div className="mt-1 border-t border-[var(--color-border)] pt-1">
                <MenuItem destructive icon={<ArchiveIcon />} onClick={() => selectAction(onArchive)}>
                  Archivar
                </MenuItem>
              </div>
            ) : (
              <div className="mt-1 border-t border-[var(--color-border)] pt-1">
                <MenuItem icon={<CheckIcon />} onClick={() => selectAction(onRestore)}>
                  Restaurar producto
                </MenuItem>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  destructive,
  icon,
  onClick,
}: {
  children: string;
  destructive?: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-structure)]",
        destructive ? "text-[var(--color-danger)]" : "text-[var(--color-text)]",
      )}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick();
      }}
      role="menuitem"
      type="button"
    >
      <span className={destructive ? "text-[var(--color-danger)]" : "text-[var(--color-title)]"}>
        {icon}
      </span>
      {children}
    </button>
  );
}
