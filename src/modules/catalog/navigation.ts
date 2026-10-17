import type { NavigationItem } from "@/shared/types/navigation.types";

export const catalogNavigationItem = {
  id: "catalog",
  label: "Catálogo y precios",
  permission: "catalog.products.read",
  children: [
    {
      id: "catalog-products",
      label: "Productos",
      href: "/catalogo/productos",
      // permission-enforcement-hardening-products: .create/.update implican poder ver el
      // listado (mismo criterio que ensureCanReadProducts) -- un rol con solo .create no
      // quedaría sin forma de llegar a la pantalla donde arranca el flujo de alta.
      anyPermission: ["catalog.products.read", "catalog.products.create", "catalog.products.update"],
    },
    {
      id: "catalog-categories",
      label: "Categorias",
      href: "/catalogo/categorias",
      // permission-enforcement-hardening: *.read ve la pantalla (mutaciones ocultas por
      // GetCategoriesService/SaveCategoryService + CategoriesPage.canManage), *.manage sigue
      // siendo lo único que habilita crear/editar/archivar.
      anyPermission: ["catalog.categories.read", "catalog.categories.manage"],
    },
    {
      id: "catalog-locations",
      label: "Ubicaciones",
      href: "/catalogo/ubicaciones",
      anyPermission: ["catalog.locations.read", "catalog.locations.manage"],
    },
    {
      id: "catalog-units",
      label: "Unidades y empaques",
      href: "/catalogo/unidades",
      anyPermission: ["catalog.units.read", "catalog.units.manage"],
    },
  ],
} satisfies NavigationItem;

export const catalogNavigation = [catalogNavigationItem] satisfies NavigationItem[];
