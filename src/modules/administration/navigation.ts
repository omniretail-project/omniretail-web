import {
  BUSINESS_CONFIG_MANAGE_PERMISSION,
  CASH_READ_PERMISSION,
  DASHBOARD_READ_PERMISSION,
  ORDERS_READ_PERMISSION,
  PLANS_READ_PERMISSION,
  REPORTS_READ_PERMISSION,
} from "@/modules/administration/permissions";
import type { NavigationItem } from "@/shared/types/navigation.types";
import { SaasCapabilityKey } from "@/core/enums";

export const administrationNavigation = [
  {
    id: "administration",
    label: "Administración",
    permission: BUSINESS_CONFIG_MANAGE_PERMISSION,
    children: [
      {
        id: "administration-dashboard",
        label: "Dashboard",
        href: "/administracion/dashboard",
        permission: DASHBOARD_READ_PERMISSION,
      },
      {
        id: "administration-branches",
        label: "Sucursales",
        href: "/administracion/sucursales",
        // *.read habilita VER la pantalla (datos visibles, mutaciones ocultas -- BranchesPage ya
        // distingue canRead/canManage); *.manage sigue siendo lo unico que habilita crear/editar/
        // archivar, sin cambios en los services.
        anyPermission: ["admin.branches.read", "admin.branches.manage"],
      },
      {
        id: "administration-business-config",
        label: "Configuración del negocio",
        href: "/administracion/configuracion-negocio",
        permission: BUSINESS_CONFIG_MANAGE_PERMISSION,
      },
      {
        id: "administration-plan",
        label: "Plan y suscripción",
        href: "/administracion/plan",
        // Solo lectura a propósito -- esta foundation no expone mutaciones de Plan/Subscription
        // (upgrade/downgrade/addons quedan fuera de este PR), así que no existe un
        // `admin.plans.manage` que agregar acá.
        permission: PLANS_READ_PERMISSION,
      },
      {
        id: "administration-roles",
        label: "Roles y permisos",
        href: "/administracion/roles-permisos",
        // Mismo criterio que Sucursales: *.read ve la pantalla, *.manage sigue siendo lo unico
        // que habilita mutaciones (RolesPage ya distingue canRead/canManage).
        anyPermission: ["admin.roles.read", "admin.roles.manage"],
      },
      {
        id: "administration-users",
        label: "Usuarios",
        href: "/administracion/usuarios",
        // Mismo criterio que Roles/Sucursales: *.read ve la pantalla, *.manage sigue siendo lo
        // unico que habilita mutaciones (EmployeesPage ya distingue canRead/canManage).
        anyPermission: ["admin.users.read", "admin.users.manage"],
      },
      {
        id: "administration-customers",
        label: "Clientes",
        href: "/administracion/clientes",
        permission: "admin.customers.read",
      },
      {
        id: "administration-ecommerce-orders",
        label: "Pedidos e-commerce",
        href: "/administracion/pedidos",
        anyPermission: [ORDERS_READ_PERMISSION, "admin.orders.manage"],
      },
      {
        id: "administration-cash",
        label: "Caja",
        href: "/administracion/caja",
        permission: CASH_READ_PERMISSION,
      },
      {
        id: "administration-reports",
        label: "Reportes",
        href: "/administracion/reportes",
        permission: REPORTS_READ_PERMISSION,
      },
      {
        id: "administration-ecommerce-config",
        capability: SaasCapabilityKey.ecommerce,
        label: "Diseño E-commerce",
        href: "/administracion/diseno-ecommerce",
        permission: "admin.ecommerce_config.manage",
      },
      {
        id: "administration-bank-accounts",
        label: "Cuentas bancarias",
        href: "/administracion/cuentas-bancarias",
        permission: "admin.bank_accounts.manage",
      },
      {
        id: "administration-suppliers",
        label: "Proveedores",
        href: "/administracion/proveedores",
        permission: "admin.suppliers.manage",
      },
    ],
  },
] satisfies NavigationItem[];
