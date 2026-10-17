import type { NavigationItem } from "@/shared/types/navigation.types";

export const purchasingNavigation = [
  {
    id: "purchasing",
    label: "Compras",
    permission: "purchasing.orders.read",
    children: [
      {
        id: "purchasing-suppliers",
        label: "Proveedores",
        href: "/compras/proveedores",
        permission: "purchasing.orders.read",
      },
      {
        id: "purchasing-orders",
        label: "Ordenes de compra",
        href: "/compras/ordenes",
        permission: "purchasing.orders.read",
      },
    ],
  },
] satisfies NavigationItem[];
