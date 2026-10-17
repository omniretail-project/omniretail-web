import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const inventoryPermissions = [
  {
    key: "inventory.stock.read",
    module: "inventory",
    name: "Leer stock",
    description: "Permite consultar stock.",
  },
  {
    key: "inventory.adjustment.create",
    module: "inventory",
    name: "Crear ajustes",
    description: "Permite registrar ajustes de inventario.",
  },
  {
    key: "inventory.movements.read",
    module: "inventory",
    name: "Leer movimientos",
    description: "Permite consultar movimientos.",
  },
  {
    key: "inventory.transfers.manage",
    module: "inventory",
    name: "Gestionar traslados",
    description: "Permite solicitar, aprobar y rechazar traslados de inventario.",
  },
  {
    key: "inventory.locations.manage",
    module: "inventory",
    name: "Gestionar ubicaciones",
    description: "Permite administrar ubicaciones.",
  },
] satisfies PermissionDefinition[];
