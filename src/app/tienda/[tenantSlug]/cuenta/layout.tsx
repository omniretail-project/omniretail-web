import type { ReactNode } from "react";
import { RequirePermission } from "@/modules/auth/components/RequirePermission";
import { ScopedActiveBranchProvider } from "@/modules/auth/components/ScopedActiveBranchProvider";
import { CustomerAccountShell } from "@/modules/customer/components/CustomerAccountShell";
import { customerNavigation } from "@/modules/customer/navigation";
import { TenantCustomerAccountGuard } from "@/modules/storefront/components/TenantCustomerAccountGuard";

export default function Layout({ children }: { children: ReactNode }) { return <TenantCustomerAccountGuard><ScopedActiveBranchProvider><CustomerAccountShell navigationItems={customerNavigation}><RequirePermission>{children}</RequirePermission></CustomerAccountShell></ScopedActiveBranchProvider></TenantCustomerAccountGuard>; }
