import type { NavigationItem } from "@/shared/types/navigation.types";

export const posNavigation = [
  {
    id: "pos",
    label: "Punto de venta",
    permission: "pos.sales.create",
    children: [
      {
        id: "pos-terminal",
        label: "Terminal de Cobro",
        href: "/pos/terminal",
        permission: "pos.sales.create",
      },
      {
        id: "pos-cash-shift",
        label: "Apertura y Arqueo de Caja",
        href: "/pos/caja",
        permission: "pos.cash.read",
      },
      {
        id: "pos-returns",
        label: "Anulaciones y Devoluciones",
        href: "/pos/anulaciones",
        permission: "pos.returns.read",
      },
    ],
  },
] satisfies NavigationItem[];
