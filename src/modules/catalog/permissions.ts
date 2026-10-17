import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const catalogPermissions = [
  {
    key: "catalog.products.read",
    module: "catalog",
    name: "Leer productos",
    description: "Permite consultar productos.",
  },
  {
    key: "catalog.products.create",
    module: "catalog",
    name: "Crear productos",
    description: "Permite crear productos.",
  },
  {
    key: "catalog.products.update",
    module: "catalog",
    name: "Actualizar productos",
    description: "Permite actualizar productos.",
  },
  {
    key: "catalog.categories.read",
    module: "catalog",
    name: "Leer categorias",
    description: "Permite consultar categorias.",
  },
  {
    key: "catalog.categories.manage",
    module: "catalog",
    name: "Gestionar categorias",
    description: "Permite administrar categorias.",
  },
  {
    key: "catalog.locations.read",
    module: "catalog",
    name: "Leer ubicaciones",
    description: "Permite consultar ubicaciones.",
  },
  {
    key: "catalog.locations.manage",
    module: "catalog",
    name: "Gestionar ubicaciones",
    description: "Permite administrar ubicaciones.",
  },
  {
    key: "catalog.units.read",
    module: "catalog",
    name: "Leer unidades",
    description: "Permite consultar unidades de medida.",
  },
  {
    key: "catalog.units.manage",
    module: "catalog",
    name: "Gestionar unidades",
    description: "Permite administrar unidades de medida.",
  },
  {
    key: "catalog.attributes.read",
    module: "catalog",
    name: "Leer atributos",
    description: "Permite consultar definiciones de atributos.",
  },
  {
    key: "catalog.attributes.manage",
    module: "catalog",
    name: "Gestionar atributos",
    description: "Permite administrar definiciones de atributos.",
  },
  {
    key: "catalog.promotions.read",
    module: "catalog",
    name: "Leer promociones",
    description: "Permite consultar promociones.",
  },
  {
    key: "catalog.promotions.manage",
    module: "catalog",
    name: "Gestionar promociones",
    description: "Permite administrar promociones.",
  },
] satisfies PermissionDefinition[];
