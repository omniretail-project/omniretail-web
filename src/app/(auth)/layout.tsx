import type { ReactNode } from "react";
import { PublicDemoBanner } from "@/modules/auth/components/PublicDemoBanner";
import { CurrentSessionProvider } from "@/modules/auth/providers/CurrentSessionProvider";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <CurrentSessionProvider>
      <PublicDemoBanner />
      {children}
    </CurrentSessionProvider>
  );
}
