"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";

export function RequireSession({ children }: { children: ReactNode }) {
  const { user, loading } = useCurrentSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/iniciar-sesion");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-[var(--color-text-muted)]">Cargando sesion...</p>
      </div>
    );
  }

  return <>{children}</>;
}
