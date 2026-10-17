import type { NavigationItem } from "@/shared/types/navigation.types";

export const logisticsNavigation = [
  {
    id: "logistics",
    label: "Logística",
    children: [
      {
        id: "logistics-picking",
        label: "Mesa de Picking",
        href: "/logistica/picking",
        permission: "logistics.picking.read",
      },
      {
        id: "logistics-dispatches",
        label: "Packing y Despacho",
        href: "/logistica/despachos",
        anyPermission: ["logistics.packing.read", "logistics.dispatch.read"],
      },
      {
        id: "logistics-history",
        label: "Historial de pedidos",
        href: "/logistica/historial",
        permission: "logistics.history.read",
      },
    ],
  },
] satisfies NavigationItem[];
