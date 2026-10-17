"use client";

import { Suspense, type ReactNode, useEffect, useId, useState } from "react";
import { PrivateHeader } from "@/shared/navigation/PrivateHeader";
import { Sidebar } from "@/shared/navigation/Sidebar";
import type { NavigationItem } from "@/shared/types/navigation.types";

type PrivateShellProps = {
  allowedPermissions?: ReadonlySet<string>;
  children: ReactNode;
  homeHref?: string;
  homeLabel?: string;
  navigationItems: NavigationItem[];
  onLogout?: () => void;
  showBranchSelector?: boolean;
  userMenuDescription?: string;
  userMenuLabel?: string;
};

export function PrivateShell({
  allowedPermissions,
  children,
  homeHref,
  homeLabel,
  navigationItems,
  onLogout,
  showBranchSelector,
  userMenuDescription,
  userMenuLabel,
}: PrivateShellProps) {
  const generatedSidebarId = useId();
  const sidebarId = `private-sidebar-${generatedSidebarId}`;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const desktopMedia = window.matchMedia("(min-width: 1024px)");

    function closeOnDesktop() {
      if (desktopMedia.matches) {
        setSidebarOpen(false);
      }
    }

    closeOnDesktop();
    desktopMedia.addEventListener("change", closeOnDesktop);

    return () => desktopMedia.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  function closeSidebar() {
    setSidebarOpen(false);
  }

  return (
    <div className="min-h-screen bg-[var(--color-app-background)]">
      <div className="flex min-h-screen">
        <Suspense
          fallback={
            <aside className="hidden h-screen w-64 shrink-0 border-r border-white/10 bg-[var(--color-structure)] px-3 py-4 text-white lg:block" />
          }
        >
          <Sidebar
            allowedPermissions={allowedPermissions}
            id={sidebarId}
            isOpen={sidebarOpen}
            items={navigationItems}
            onClose={closeSidebar}
            onNavigate={closeSidebar}
          />
        </Suspense>
        {sidebarOpen ? (
          <button
            aria-label="Cerrar navegacion"
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={closeSidebar}
            tabIndex={-1}
            type="button"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <PrivateHeader
            homeHref={homeHref}
            homeLabel={homeLabel}
            onLogout={onLogout}
            onOpenSidebar={() => setSidebarOpen(true)}
            showBranchSelector={showBranchSelector}
            sidebarId={sidebarId}
            sidebarOpen={sidebarOpen}
            userMenuDescription={userMenuDescription}
            userMenuLabel={userMenuLabel}
          />
          <main className="min-w-0 flex-1 p-4 sm:p-5 lg:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
