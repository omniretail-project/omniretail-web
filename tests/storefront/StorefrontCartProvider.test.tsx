import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  apiMode: false,
  getProduct: vi.fn(),
}));

const repositories = {
  products: {
    getPublishedForEcommerce: vi.fn().mockResolvedValue([
      { id: "product-1", tenantId: "tenant-1", sku: "TAL-001", name: "Taladro", salePrice: 100 },
    ]),
  },
  businessConfig: { getEcommerceConfig: vi.fn().mockResolvedValue({ defaultBranchId: "branch-1" }) },
  productMedia: { getPrimaryByProduct: vi.fn().mockResolvedValue(null) },
  productSalesPriceTiers: { getByProduct: vi.fn().mockResolvedValue([]) },
  promotions: { getApplicable: vi.fn().mockResolvedValue(null) },
};

vi.mock("@/config/api-mode", () => ({ isApiMode: () => state.apiMode }));
vi.mock("@/modules/storefront/application/services/ApiStorefrontCatalogService", () => ({
  ApiStorefrontCatalogService: class {
    getProduct = state.getProduct;
  },
}));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({ useRepositories: () => repositories }));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => ({ tenantId: "tenant-1", tenantSlug: "ferreteria" }),
}));

import { StorefrontCartProvider, useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";

function CartProbe() {
  const cart = useStorefrontCart();
  return (
    <>
      <output data-testid="last-added">{cart.lastAddedAt ?? "sin-agregar"}</output>
      <output data-testid="subtotal">{cart.subtotal.toFixed(2)}</output>
      <button onClick={() => void cart.addProduct("product-1")}>Agregar</button>
      <button onClick={() => void cart.addProduct("product-1", 3)}>Agregar tres</button>
      <button onClick={() => cart.updateQuantity("product-1", 1)}>Dejar uno</button>
    </>
  );
}

describe("StorefrontCartProvider", () => {
  it("actualiza la marca de tiempo después de agregar un producto", async () => {
    state.apiMode = false;
    render(<StorefrontCartProvider><CartProbe /></StorefrontCartProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(screen.getByTestId("last-added")).not.toHaveTextContent("sin-agregar"));
    expect(screen.getByTestId("last-added")).toHaveTextContent(/^\d+$/);
  });

  it("también actualiza la marca de tiempo en modo API", async () => {
    state.apiMode = true;
    state.getProduct.mockResolvedValue({
      id: "product-1", sku: "TAL-001", name: "Taladro", salePrice: 100, availableQuantity: 2,
    });
    render(<StorefrontCartProvider><CartProbe /></StorefrontCartProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(screen.getByTestId("last-added")).not.toHaveTextContent("sin-agregar"));
    expect(state.getProduct).toHaveBeenCalledWith("ferreteria", "product-1");
    state.apiMode = false;
  });

  it("en modo API cobra el precio final por cantidad del backend y lo recalcula al cambiar", async () => {
    state.apiMode = true;
    state.getProduct.mockResolvedValue({
      id: "product-1",
      sku: "TAL-001",
      name: "Taladro",
      salePrice: 100,
      effectivePrice: 90,
      availableQuantity: 10,
      finalPriceTiers: [{ minQuantity: 2, unitPrice: 72, active: true }],
    });
    render(<StorefrontCartProvider><CartProbe /></StorefrontCartProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Agregar tres" }));
    // 3 unidades al precio del escalón (Q72, ya con la promoción del backend).
    await waitFor(() => expect(screen.getByTestId("subtotal")).toHaveTextContent("216.00"));

    fireEvent.click(screen.getByRole("button", { name: "Dejar uno" }));
    // Una unidad vuelve al precio final sin escalón (Q90, no el precio de lista Q100).
    await waitFor(() => expect(screen.getByTestId("subtotal")).toHaveTextContent("90.00"));
    state.apiMode = false;
  });
});
