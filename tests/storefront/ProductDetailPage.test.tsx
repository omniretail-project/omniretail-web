import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  addProduct: vi.fn().mockResolvedValue(true),
  showToast: vi.fn(),
  availableQuantity: 4,
  loading: false,
  error: null as string | null,
  reload: vi.fn(),
  finalPricing: undefined as
    | { basePrice: number; tiers: Array<{ minQuantity: number; unitPrice: number; active: boolean }> }
    | undefined,
}));

vi.mock("@/modules/storefront/hooks/useStorefrontProductDetail", () => ({
  useStorefrontProductDetail: () => ({
    loading: state.loading,
    error: state.error,
    reload: state.reload,
    data: state.loading || state.error ? null : {
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
      finalPricing: state.finalPricing,
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

  it("en modo api aplica el precio final por cantidad que calcula el backend", () => {
    state.finalPricing = {
      basePrice: 75,
      tiers: [{ minQuantity: 2, unitPrice: 60, active: true }],
    };
    render(<ProductDetailPage productId="product-1" />);

    expect(screen.getAllByText("Q75.00")).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox", { name: "Cantidad a ordenar" }), {
      target: { value: "3" },
    });

    // Desde 2 unidades: Q60 por unidad, Q180 en total (no Q75 x 3).
    expect(screen.getByText("Q60.00")).toBeInTheDocument();
    expect(screen.getByText("Q180.00")).toBeInTheDocument();
    state.finalPricing = undefined;
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

  it("restaura una cantidad vacía y permite ajustar con los botones", () => {
    render(<ProductDetailPage productId="product-1" />);
    const quantityInput = screen.getByRole("textbox", { name: "Cantidad a ordenar" });

    fireEvent.change(quantityInput, { target: { value: "" } });
    fireEvent.blur(quantityInput);
    expect(quantityInput).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: "Aumentar cantidad" }));
    expect(quantityInput).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: "Reducir cantidad" }));
    expect(quantityInput).toHaveValue("1");
  });

  it("muestra los estados de carga y error, permitiendo reintentar", () => {
    state.loading = true;
    const { rerender } = render(<ProductDetailPage productId="product-1" />);
    expect(screen.getByText("Cargando producto...")).toBeInTheDocument();

    state.loading = false;
    state.error = "No se pudo cargar el producto.";
    rerender(<ProductDetailPage productId="product-1" />);
    expect(screen.getByText("No se pudo cargar el producto.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(state.reload).toHaveBeenCalled();

    state.error = null;
  });

  it("muestra el aviso cuando el carrito rechaza la cantidad", async () => {
    state.addProduct.mockReset().mockResolvedValue(false);
    render(<ProductDetailPage productId="product-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));

    await vi.waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    state.addProduct.mockResolvedValue(true);
  });
});
