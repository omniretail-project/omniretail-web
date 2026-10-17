import type { ReactNode } from "react";
import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { RequireSession } from "@/modules/auth/components/RequireSession";
import { ScopedActiveBranchProvider } from "@/modules/auth/components/ScopedActiveBranchProvider";
import { CustomerAccountShell } from "@/modules/customer/components/CustomerAccountShell";
import { customerNavigation } from "@/modules/customer/navigation";

/**
 * /cuenta vive bajo (public)/(accessible) -- fuera de (private), asi que
 * no hereda RequireSession/RequirePermission/ScopedActiveBranchProvider
 * del layout raiz (el storefront publico es abierto a invitados). Se
 * reproducen aca, localmente, solo para este subarbol -- mismos
 * componentes que usa (private)/layout.tsx para Employee/Admin, pero
 * CustomerAccountShell reemplaza a AuthorizedPrivateShell para que
 * Customer nunca dependa del shell operativo de backoffice.
 */
export default function CuentaLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <ScopedActiveBranchProvider>
        <CustomerAccountShell navigationItems={customerNavigation}>
          <RequirePermission>{children}</RequirePermission>
        </CustomerAccountShell>
      </ScopedActiveBranchProvider>
    </RequireSession>
  );
}
