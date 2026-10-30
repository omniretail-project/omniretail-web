import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cartItems: [] as Array<{ productId: string; quantity: number }>,
  tenant: { tenantId: "tenant-1" as string | null, tenantSlug: "demo", loading: false, error: null as string | null },
}));

vi.mock("@/config/api-mode", () => ({ isApiMode: () => true }));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const eventBus = { subscribe: () => () => undefined };
  const repositories = {};
  return { useRepositories: () => repositories, useDataEventBus: () => eventBus };
});
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => state.tenant,
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
  const { products, loading, error, reload } = useStorefrontDiscovery();
  const { items: offers, error: offersError } = useStorefrontOffers();
  if (loading) return <p>cargando</p>;
  if (error) {
    return (
      <>
        <p>{error}</p>
        <p>{offersError}</p>
        <button onClick={reload} type="button">reintentar</button>
      </>
    );
  }
  return <p>{`page:${products.length} offers:${offers.map((offer) => offer.productId).join(",")}`}</p>;
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
  state.tenant = { tenantId: "tenant-1", tenantSlug: "demo", loading: false, error: null };
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

  it("reporta el error de la tienda sin descargar cuando no hay tenant", async () => {
    state.tenant = { tenantId: null, tenantSlug: "demo", loading: false, error: "La tienda publica no esta disponible." };
    render(<Storefront />);

    expect(await screen.findByText("La tienda publica no esta disponible.")).toBeTruthy();
    expect(screen.getByText("No se pudieron cargar las ofertas.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("muestra el error de carga y permite reintentar", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    render(<Storefront />);

    expect(await screen.findByText("No se pudo cargar la tienda. Intenta nuevamente.")).toBeTruthy();
    fireEvent.click(screen.getByText("reintentar"));

    expect(await screen.findByText("page:2 offers:p-1")).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("exige montar el provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<HeaderConsumer />)).toThrow(
      "useStorefrontCatalogContext must be used inside StorefrontCatalogProvider",
    );
  });
});
