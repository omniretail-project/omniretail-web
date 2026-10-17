import type { PermissionDefinition } from "@/shared/types/permissions.types";

/**
 * La configuracion del negocio es tenant-wide: quien no tenga este permiso no puede modificarla,
 * ni desde la pantalla ni desde ningun otro consumidor del service.
 */
export const BUSINESS_CONFIG_MANAGE_PERMISSION = "admin.business_config.manage";
/**
 * El remitente de correo del tenant (Gmail + contraseña de aplicación) es tenant-wide y sensible:
 * `read` solo muestra remitente/estado (nunca el secreto); `manage` cambia credenciales, envía
 * pruebas y desconecta.
 */
export const EMAIL_CONFIG_READ_PERMISSION = "admin.email_config.read";
export const EMAIL_CONFIG_MANAGE_PERMISSION = "admin.email_config.manage";
export const CASH_READ_PERMISSION = "admin.cash.read";
export const DASHBOARD_READ_PERMISSION = "admin.dashboard.read";
export const REPORTS_READ_PERMISSION = "admin.reports.read";
export const REPORTS_EXPORT_PERMISSION = "admin.reports.export";
export const ORDERS_READ_PERMISSION = "admin.orders.read";
export const ORDERS_MANAGE_PERMISSION = "admin.orders.manage";
/**
 * `PLANS_READ_PERMISSION` habilita consultar el plan; `PLANS_MANAGE_PERMISSION` habilita
 * cambiarlo. Add-ons, cancelación y facturación siguen sin permiso propio porque todavía no
 * existen.
 */
export const PLANS_READ_PERMISSION = "admin.plans.read";
export const PLANS_MANAGE_PERMISSION = "admin.plans.manage";

export const administrationPermissions = [
  {
    key: "admin.users.read",
    module: "administration",
    name: "Leer usuarios",
    description: "Permite consultar usuarios.",
  },
  {
    key: "admin.users.manage",
    module: "administration",
    name: "Gestionar usuarios",
    description: "Permite administrar usuarios.",
  },
  {
    key: "admin.roles.read",
    module: "administration",
    name: "Leer roles",
    description: "Permite consultar roles.",
  },
  {
    key: "admin.roles.manage",
    module: "administration",
    name: "Gestionar roles",
    description: "Permite administrar roles.",
  },
  {
    key: "admin.branches.read",
    module: "administration",
    name: "Leer sucursales",
    description: "Permite consultar sucursales.",
  },
  {
    key: "admin.branches.manage",
    module: "administration",
    name: "Gestionar sucursales",
    description: "Permite administrar sucursales.",
  },
  {
    key: BUSINESS_CONFIG_MANAGE_PERMISSION,
    module: "administration",
    name: "Gestionar configuracion",
    description: "Permite modificar configuracion del negocio.",
  },
  {
    key: EMAIL_CONFIG_READ_PERMISSION,
    module: "administration",
    name: "Leer correo remitente",
    description: "Permite consultar el remitente de correo y su estado, sin ver credenciales.",
  },
  {
    key: EMAIL_CONFIG_MANAGE_PERMISSION,
    module: "administration",
    name: "Gestionar correo remitente",
    description: "Permite configurar, probar y desconectar el correo remitente del negocio.",
  },
  {
    key: "admin.suppliers.manage",
    module: "administration",
    name: "Gestionar proveedores",
    description: "Permite administrar proveedores.",
  },
  {
    key: "admin.bank_accounts.manage",
    module: "administration",
    name: "Gestionar cuentas bancarias",
    description: "Permite administrar cuentas bancarias.",
  },
  {
    key: "admin.customers.read",
    module: "administration",
    name: "Leer clientes",
    description: "Permite consultar el listado de clientes más frecuentes.",
  },
  {
    key: ORDERS_READ_PERMISSION,
    module: "administration",
    name: "Leer pedidos e-commerce",
    description: "Permite consultar los pedidos realizados en la tienda en línea.",
  },
  {
    key: ORDERS_MANAGE_PERMISSION,
    module: "administration",
    name: "Gestionar pedidos e-commerce",
    description: "Permite confirmar o cancelar pedidos de la tienda en línea.",
  },
  {
    key: CASH_READ_PERMISSION,
    module: "administration",
    name: "Leer caja",
    description: "Permite consultar los turnos de caja y su conciliación.",
  },
  {
    key: DASHBOARD_READ_PERMISSION,
    module: "administration",
    name: "Ver dashboard",
    description: "Permite ver el resumen ejecutivo del negocio.",
  },
  {
    key: REPORTS_READ_PERMISSION,
    module: "administration",
    name: "Ver reportes",
    description: "Permite consultar los reportes agregados del negocio.",
  },
  {
    key: REPORTS_EXPORT_PERMISSION,
    module: "administration",
    name: "Exportar reportes",
    description: "Permite exportar reportes a CSV.",
  },
  {
    key: PLANS_READ_PERMISSION,
    module: "administration",
    name: "Leer plan y suscripción",
    description: "Permite consultar el plan contratado, capabilities y uso del negocio.",
  },
  {
    key: PLANS_MANAGE_PERMISSION,
    module: "administration",
    name: "Gestionar plan y suscripción",
    description: "Permite cambiar el plan contratado del negocio.",
  },
  {
    key: "admin.ecommerce_config.manage",
    module: "administration",
    name: "Gestionar diseño e-commerce",
    description: "Permite configurar la tienda en línea del negocio.",
  },
] satisfies PermissionDefinition[];
