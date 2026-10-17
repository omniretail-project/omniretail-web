import { catalogNavigationItem } from "@/modules/catalog/navigation";
import type { NavigationItem } from "@/shared/types/navigation.types";

export const inventoryNavigation = [
  {
    id: "inventory",
    label: "Inventario",
    permission: "inventory.stock.read",
    children: [
      {
        id: "inventory-alerts",
        label: "Inventario y alertas",
        href: "/inventario/alertas",
        permission: "inventory.stock.read",
      },
      {
        ...catalogNavigationItem,
      },
      {
        id: "inventory-movements",
        label: "Historial de movimientos",
        href: "/inventario/movimientos",
        permission: "inventory.movements.read",
      },
      {
        id: "inventory-location-regularization",
        label: "Regularización de ubicaciones",
        href: "/inventario/regularizacion",
        // Misma autorizacion que la ejecucion (ajustes); la vista previa solo requiere stock.read.
        permission: "inventory.adjustment.create",
      },
    ],
  },
] satisfies NavigationItem[];
