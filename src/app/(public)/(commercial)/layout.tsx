import type { ReactNode } from "react";
import { CommercialStorefrontGate } from "@/modules/storefront/components/CommercialStorefrontGate";

export default function CommercialStorefrontLayout({ children }: { children: ReactNode }) {
  return <CommercialStorefrontGate>{children}</CommercialStorefrontGate>;
}
