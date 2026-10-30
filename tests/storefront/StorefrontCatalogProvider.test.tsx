import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cartItems: [] as Array<{ productId: string; quantity: number }>,
}));

vi.mock("@/config/api-mode", () => ({ isApiMode: () => true }));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const eventBus = { subscribe: () => () => undefined };
  const repositories = {};
  return { useRepositories: () => repositories, useDataEventBus: () => eventBus };
});
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => ({ tenantId: "tenant-1", tenantSlug: "demo", loading: false, error: null }),
}));
vi.mock("@/modules/storefront/providers/StorefrontCartProvider", () => ({
  useStorefrontCart: () => ({ items: state.cartItems }),
}));

import { useStorefrontDiscovery } from "@/modules/storefront/hooks/useStorefrontDiscovery";
import { useStorefrontOffers } from "@/modules/storefront/hooks/useStorefrontOffers";
import { StorefrontCatalogProvider } from "@/modules/storefront/providers/StorefrontCatalogProvider";

const fetchSpy = vi.fn();

const backendProducts = [
  { id: "p-1", sku: "A", name: "Con descuento", salePrice: 100, basePrice: 100, effectivePrice: 80, discountAmount: 20, categoryId: "c-1", categoryName: "General" },
  { id: "p-2", sku: "B", name: "Precio normal", salePrice: 50, categoryId: "c-1", categoryName: "General" },
];

function HeaderConsumer() {
  const { products } = useStorefrontDiscovery();
  return <p>header:{products.length}</p>;
}

function PageConsumer() {
  const { products, loading } = useStorefrontDiscovery();
  const { items: offers } = useStorefrontOffers();
  return <p>{loading ? "cargando" : `page:${products.length} offers:${offers.map((offer) => offer.productId).join(",")}`}</p>;
}

function Storefront() {
  return (
    <StorefrontCatalogProvider>
      <HeaderConsumer />
      <PageConsumer />
    </StorefrontCatalogProvider>
  );
}

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async () => new Response(JSON.stringify(backendProducts), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  state.cartItems = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StorefrontCatalogProvider", () => {
  it("descarga el catalogo una sola vez para header, pagina y ofertas", async () => {
    render(<Storefront />);

    expect(await screen.findByText("page:2 offers:p-1")).toBeTruthy();
    expect(screen.getByText("header:2")).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/backend/public/demo/products", { cache: "no-store" });
  });

  it("no vuelve a descargar el catalogo cuando cambia el carrito", async () => {
    const { rerender } = render(<Storefront />);
    await screen.findByText("page:2 offers:p-1");

    state.cartItems = [{ productId: "p-1", quantity: 3 }];
    rerender(<Storefront />);

    await waitFor(() => expect(screen.getByText("page:2 offers:p-1")).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
