import type { NavigationItem } from "@/shared/types/navigation.types";

export const customerNavigation = [
  {
    id: "customer-account",
    label: "Mi cuenta",
    permission: "customer.account.read",
    children: [
      {
        id: "customer-account-profile",
        label: "Perfil",
        href: "/cuenta/perfil",
        permission: "customer.account.read",
      },
      {
        id: "customer-account-addresses",
        label: "Direcciones",
        href: "/cuenta/direcciones",
        permission: "customer.address.manage",
      },
      {
        id: "customer-account-payment-methods",
        label: "Métodos de pago",
        href: "/cuenta/metodos-pago",
        permission: "customer.payment_method.manage",
      },
      {
        id: "customer-account-orders",
        label: "Mis pedidos",
        // storefront.orders.read (no customer.account.read): ya existe en
        // el modulo storefront especificamente para "consultar pedidos de
        // e-commerce" y role-customer ya lo tenia asignado antes de este
        // PR -- reutilizarlo evita duplicar un permiso con el mismo
        // proposito bajo un nombre distinto.
        href: "/cuenta/pedidos",
        permission: "storefront.orders.read",
      },
      {
        id: "customer-account-security",
        label: "Seguridad",
        href: "/cuenta/seguridad",
        permission: "customer.account.read",
      },
      {
        id: "customer-account-support",
        label: "Soporte",
        href: "/cuenta/soporte",
        permission: "customer.account.read",
      },
    ],
  },
] satisfies NavigationItem[];
