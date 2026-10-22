"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";
import { useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";
import { useToast } from "@/shared/components/Toast";

const MIN_SHOW_SCROLL_Y = 240;
const MAX_SHOW_SCROLL_Y = 320;
const VIEWPORT_SCROLL_RATIO = 0.4;
const HIDE_OFFSET = 96;

type StorefrontRoutes = ReturnType<typeof useStorefrontRoutes>;

function isShoppingRoute(pathname: string, routes: StorefrontRoutes): boolean {
  const catalogPath = routes.catalog();

  return (
    pathname === routes.home() ||
    pathname === catalogPath ||
    pathname.startsWith(`${catalogPath}/`) ||
    pathname === routes.offers() ||
    pathname === routes.branches() ||
    pathname === routes.help()
  );
}

function getShowThreshold(viewportHeight: number): number {
  return Math.min(
    MAX_SHOW_SCROLL_Y,
    Math.max(MIN_SHOW_SCROLL_Y, viewportHeight * VIEWPORT_SCROLL_RATIO),
  );
}

export function StorefrontFloatingCart() {
  const pathname = usePathname();
  const routes = useStorefrontRoutes();
  const { itemCount } = useStorefrontCart();
  const { toasts } = useToast();
  const [scrollVisibility, setScrollVisibility] = useState({
    pathname: "",
    visible: false,
  });

  useEffect(() => {
    const updateVisibility = () => {
      const showThreshold = getShowThreshold(window.innerHeight);
      const hideThreshold = showThreshold - HIDE_OFFSET;

      setScrollVisibility((current) => {
        const wasVisibleOnCurrentRoute = current.pathname === pathname && current.visible;
        const visible = wasVisibleOnCurrentRoute
          ? window.scrollY > hideThreshold
          : window.scrollY >= showThreshold;

        return current.pathname === pathname && current.visible === visible
          ? current
          : { pathname, visible };
      });
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [pathname]);

  if (itemCount <= 0 || !isShoppingRoute(pathname, routes)) return null;

  const isVisible = scrollVisibility.pathname === pathname && scrollVisibility.visible;
  const hasVisibleToast = toasts.length > 0;
  const itemLabel = itemCount === 1 ? "artículo" : "artículos";

  return (
    <Link
      aria-hidden={!isVisible}
      aria-label={`Ver carrito, ${itemCount} ${itemLabel}`}
      className={`fixed z-20 grid h-14 w-14 place-items-center rounded-full border border-white/35 bg-[var(--color-primary)] text-[var(--color-topbar)] shadow-lg shadow-slate-900/20 transition-[right,bottom,opacity,transform] duration-200 ease-out hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-structure)] motion-reduce:transform-none motion-reduce:transition-none ${
        hasVisibleToast
          ? "bottom-[calc(8rem+env(safe-area-inset-bottom))] right-4 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-[26rem]"
          : "bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-6"
      } ${isVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
      data-testid="storefront-floating-cart"
      href={routes.cart()}
      tabIndex={isVisible ? undefined : -1}
    >
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 8H6" />
        <circle cx="9" cy="20" r="1" />
        <circle cx="18" cy="20" r="1" />
      </svg>
      <span
        aria-hidden="true"
        className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-topbar)] px-1 text-[10px] font-black leading-none text-white shadow-sm"
      >
        {itemCount}
      </span>
    </Link>
  );
}
