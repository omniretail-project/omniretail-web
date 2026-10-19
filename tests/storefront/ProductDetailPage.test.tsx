import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  addProduct: vi.fn().mockResolvedValue(true),
  showToast: vi.fn(),
  availableQuantity: 4,
}));

vi.mock("@/modules/storefront/hooks/useStorefrontProductDetail", () => ({
  useStorefrontProductDetail: () => ({
    loading: false,
    error: null,
    reload: vi.fn(),
    data: {
      product: {
        id: "product-1",
        sku: "MAR-001",
        name: "Martillo de uña 16 oz",
        description: "Martillo de prueba",
        brand: "Truper",
        salePrice: 75,
      },
      categoryName: "Herramientas manuales",
      media: [],
      attributes: [{ name: "Peso", value: "16 oz" }],
      availability: [{
        branchId: "branch-1",
        branchName: "Sucursal Centro",
        address: "Zona 1, Guatemala",
        available: true,
      }],
      availableQuantity: state.availableQuantity,
    },
  }),
}));
vi.mock("@/modules/storefront/providers/StorefrontCartProvider", () => ({
  useStorefrontCart: () => ({ addProduct: state.addProduct, items: [] }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontDiscovery", () => ({
  useStorefrontDiscovery: () => ({ products: [] }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontOffers", () => ({
  useStorefrontOffers: () => ({ items: [] }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({
  useStorefrontRoutes: () => ({ catalog: () => "/catalogo", cart: () => "/carrito" }),
}));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: state.showToast }) }));
vi.mock("@/modules/storefront/components/StorefrontCatalogImage", () => ({
  StorefrontCatalogImage: () => <div data-testid="catalog-image" />,
}));
vi.mock("@/modules/storefront/components/StorefrontUnavailableQuantityModal", () => ({
  StorefrontUnavailableQuantityModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Cantidad no disponible</div> : null,
}));

import { ProductDetailPage } from "@/modules/storefront/pages/ProductDetailPage";

describe("ProductDetailPage", () => {
  it("muestra atributos y sucursales, y permite escribir una cantidad dentro del inventario", () => {
    render(<ProductDetailPage productId="product-1" />);

    expect(screen.getByText("Peso")).toBeInTheDocument();
    expect(screen.getByText("16 oz")).toBeInTheDocument();
    expect(screen.getByText("Sucursal Centro")).toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeInTheDocument();

    const quantityInput = screen.getByRole("textbox", { name: "Cantidad a ordenar" });
    fireEvent.change(quantityInput, { target: { value: "3" } });

    expect(quantityInput).toHaveValue("3");
    expect(screen.getByText("Q225.00")).toBeInTheDocument();
  });

  it("rechaza una cantidad superior al inventario disponible", () => {
    render(<ProductDetailPage productId="product-1" />);

    fireEvent.change(screen.getByRole("textbox", { name: "Cantidad a ordenar" }), {
      target: { value: "5" },
    });

    expect(screen.getByRole("textbox", { name: "Cantidad a ordenar" })).toHaveValue("1");
    expect(screen.getByRole("dialog")).toHaveTextContent("Cantidad no disponible");
  });

  it("muestra el estado agotado cuando no hay existencias", () => {
    state.availableQuantity = 0;
    render(<ProductDetailPage productId="product-1" />);

    expect(screen.getByRole("button", { name: "Agotado" })).toBeDisabled();
    expect(screen.getByText(/Agotado por el momento/)).toBeInTheDocument();

    state.availableQuantity = 4;
  });

  it("agrega la cantidad elegida al carrito", async () => {
    render(<ProductDetailPage productId="product-1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Cantidad a ordenar" }), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));

    await vi.waitFor(() => expect(state.addProduct).toHaveBeenCalledWith("product-1", 2));
    expect(state.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: "success" }));
  });
});
