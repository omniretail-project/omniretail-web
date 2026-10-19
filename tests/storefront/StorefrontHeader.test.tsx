import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { type: string } | null,
  loading: false,
  products: [] as Array<{
    id: string;
    name: string;
    sku: string;
    brand?: string;
    categoryName?: string;
    salePrice: number;
    imageAlt?: string;
    imageSource?: { kind: "url"; src: string };
  }>,
  push: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, onClick, ...props }: ComponentProps<"a"> & { children: ReactNode }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/modules/storefront/components/StorefrontCatalogImage", () => ({
  StorefrontCatalogImage: () => <span>imagen</span>,
}));
vi.mock("@/modules/storefront/providers/StorefrontCartProvider", () => ({
  useStorefrontCart: () => ({ itemCount: 2, lastAddedAt: 123 }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontDiscovery", () => ({
  useStorefrontDiscovery: () => ({ products: state.products }),
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => state,
}));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => ({ config: { storeName: "Ferretería" } }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({
  useStorefrontRoutes: () => ({
    home: () => "/",
    cart: () => "/carrito",
    login: () => "/login",
    account: () => "/cuenta",
    catalog: () => "/catalogo",
    offers: () => "/ofertas",
    branches: () => "/sucursales",
    help: () => "/ayuda",
    product: (id: string) => `/producto/${id}`,
  }),
}));

import { StorefrontHeader } from "@/modules/storefront/components/StorefrontHeader";

describe("StorefrontHeader", () => {
  it("resalta el contador cuando se agrega un artículo al carrito", () => {
    render(<StorefrontHeader />);

    const counter = screen.getByText("2");
    expect(counter).toHaveClass("animate-[bounce_0.9s_ease-in-out_1]");
    expect(counter).toHaveClass("ring-4");
  });

  it("muestra la navegación adecuada según la sesión", () => {
    state.user = { type: "customer" };
    const customer = render(<StorefrontHeader />);
    expect(screen.getByLabelText("Mi Cuenta")).toHaveAttribute("href", "/cuenta");
    customer.unmount();

    state.user = { type: "employee" };
    render(<StorefrontHeader />);
    expect(screen.getByLabelText("Ir a inicio")).toHaveAttribute("href", "/inicio");
    state.user = null;
  });

  it("muestra sugerencias y permite buscar desde el encabezado", () => {
    state.products = [{
      id: "product-1",
      name: "Taladro percutor",
      sku: "TAL-001",
      brand: "Acme",
      categoryName: "Herramientas",
      salePrice: 125,
    }];
    render(<StorefrontHeader />);

    const search = screen.getByRole("textbox", { name: "Buscar productos" });
    fireEvent.change(search, { target: { value: "taladro" } });

    expect(screen.getByText("Sugerencias de productos")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Taladro percutor"));
    expect(search).toHaveValue("");

    fireEvent.change(search, { target: { value: "sin coincidencia" } });
    expect(screen.getByText(/No encontramos productos/)).toBeInTheDocument();

    fireEvent.submit(search.closest("form")!);
    expect(state.push).toHaveBeenCalledWith("/catalogo?q=sin%20coincidencia");
    state.products = [];
  });
});
