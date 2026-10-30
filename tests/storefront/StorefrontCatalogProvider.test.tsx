import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BusEvent = { tenantId?: string };

const state = vi.hoisted(() => ({
  apiMode: true,
  cartItems: [] as Array<{ productId: string; quantity: number }>,
  tenant: { tenantId: "tenant-1" as string | null, tenantSlug: "demo", loading: false, error: null as string | null },
  listeners: new Map<string, Set<(event: BusEvent) => void>>(),
  mockDiscovery: vi.fn(),
}));

vi.mock("@/config/api-mode", () => ({ isApiMode: () => state.apiMode }));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const eventBus = {
    subscribe: (type: string, listener: (event: BusEvent) => void) => {
      const listeners = state.listeners.get(type) ?? new Set();
      listeners.add(listener);
      state.listeners.set(type, listeners);
      return () => listeners.delete(listener);
    },
  };
  const repositories = {};
  return { useRepositories: () => repositories, useDataEventBus: () => eventBus };
});
vi.mock("@/modules/storefront/application/services/GetStorefrontDiscoveryService", () => ({
  GetStorefrontDiscoveryService: class {
    execute(...args: unknown[]) {
      return state.mockDiscovery(...args);
    }
  },
}));
vi.mock("@/modules/storefront/application/services/ResolvePublicStorefrontContextService", () => ({
  ensurePublicStorefrontTenant: async () => {
    throw new Error("Tienda no disponible en la prueba");
  },
}));
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
  {
    id: "p-1",
    sku: "A",
    name: "Con descuento",
    description: "Detalle",
    primaryImageUrl: "/media/foto.webp",
    primaryImageAlt: "Foto",
    salePrice: 100,
    basePrice: 100,
    effectivePrice: 80,
    discountAmount: 20,
    categoryId: "c-1",
    categoryName: "General",
  },
  { id: "p-2", sku: "B", name: "Precio normal", salePrice: 50, categoryId: "c-1", categoryName: "General" },
  { id: "p-3", sku: "C", name: "Solo descuento", salePrice: 40, discountAmount: 5, categoryId: "c-1" },
];

function emit(type: string, event: BusEvent) {
  act(() => state.listeners.get(type)?.forEach((listener) => listener(event)));
}

function HeaderConsumer() {
  const { products } = useStorefrontDiscovery();
  return <p>header:{products.length}</p>;
}

function OffersConsumer() {
  const { items } = useStorefrontOffers();
  return (
    <ul>
      {items.map((offer) => (
        <li key={offer.productId}>
          {`${offer.productId}:${offer.basePrice}->${offer.effectivePrice}:${offer.description ?? "-"}:${offer.imageAlt}`}
        </li>
      ))}
    </ul>
  );
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
  state.apiMode = true;
  state.cartItems = [];
  state.tenant = { tenantId: "tenant-1", tenantSlug: "demo", loading: false, error: null };
  state.listeners.clear();
  state.mockDiscovery.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StorefrontCatalogProvider", () => {
  it("descarga el catalogo una sola vez para header, pagina y ofertas", async () => {
    render(<Storefront />);

    expect(await screen.findByText("page:3 offers:p-1,p-3")).toBeTruthy();
    expect(screen.getByText("header:3")).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/backend/public/demo/products", { cache: "no-store" });
  });

  it("no vuelve a descargar el catalogo cuando cambia el carrito", async () => {
    const { rerender } = render(<Storefront />);
    await screen.findByText("page:3 offers:p-1,p-3");

    state.cartItems = [{ productId: "p-1", quantity: 3 }];
    rerender(<Storefront />);

    await waitFor(() => expect(screen.getByText("page:3 offers:p-1,p-3")).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("deriva las ofertas con los precios del backend o, si faltan, con el precio de venta", async () => {
    render(
      <StorefrontCatalogProvider>
        <OffersConsumer />
      </StorefrontCatalogProvider>,
    );

    expect(await screen.findByText("p-1:100->80:Detalle:Foto")).toBeTruthy();
    expect(screen.getByText("p-3:40->40:-:Solo descuento")).toBeTruthy();
    expect(screen.queryByText(/^p-2:/)).toBeNull();
  });

  it.each(["product.changed", "category.changed", "stock.changed"])(
    "recarga el catalogo ante %s de la misma tienda e ignora otras tiendas",
    async (type) => {
      render(<Storefront />);
      await screen.findByText("page:3 offers:p-1,p-3");

      emit(type, { tenantId: "otra-tienda" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      emit(type, { tenantId: "tenant-1" });
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    },
  );

  it("espera a que la tienda termine de resolverse antes de descargar", async () => {
    state.tenant = { tenantId: "tenant-1", tenantSlug: "demo", loading: true, error: null };
    const { rerender } = render(<Storefront />);
    emit("product.changed", { tenantId: "tenant-1" });

    expect(screen.getByText("cargando")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    state.tenant = { ...state.tenant, loading: false };
    rerender(<Storefront />);
    expect(await screen.findByText("page:3 offers:p-1,p-3")).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("en modo mock lee el catalogo del servicio de discovery", async () => {
    state.apiMode = false;
    state.mockDiscovery.mockResolvedValue({
      categories: [],
      products: [{ id: "m-1", sku: "M", name: "Mock", salePrice: 10, categoryId: "c-1" }],
    });
    render(<Storefront />);

    expect(await screen.findByText("page:1 offers:")).toBeTruthy();
    expect(state.mockDiscovery).toHaveBeenCalledWith("demo", "tenant-1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reporta el error de la tienda sin descargar cuando no hay tenant", async () => {
    state.tenant = { tenantId: null, tenantSlug: "demo", loading: false, error: "La tienda publica no esta disponible." };
    render(<Storefront />);

    expect(await screen.findByText("La tienda publica no esta disponible.")).toBeTruthy();
    expect(screen.getByText("No se pudieron cargar las ofertas.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("usa un mensaje por defecto cuando la tienda no informa el motivo", async () => {
    state.tenant = { tenantId: null, tenantSlug: "demo", loading: false, error: null };
    render(<Storefront />);

    expect(await screen.findByText("No se pudo determinar la tienda pública.")).toBeTruthy();
  });

  it("muestra el error de carga y permite reintentar", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    render(<Storefront />);

    expect(await screen.findByText("No se pudo cargar la tienda. Intenta nuevamente.")).toBeTruthy();
    fireEvent.click(screen.getByText("reintentar"));

    expect(await screen.findByText("page:3 offers:p-1,p-3")).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("descarta la respuesta si el provider se desmonta antes de que llegue", async () => {
    let resolve: (response: Response) => void = () => undefined;
    fetchSpy.mockImplementationOnce(() => new Promise<Response>((done) => (resolve = done)));
    const { unmount } = render(<Storefront />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    unmount();
    resolve(new Response(JSON.stringify(backendProducts), { status: 200 }));
    await act(async () => undefined);

    expect(screen.queryByText(/page:/)).toBeNull();
  });

  it("descarta el error si el provider se desmonta antes de que falle la carga", async () => {
    let reject: (error: Error) => void = () => undefined;
    fetchSpy.mockImplementationOnce(() => new Promise<Response>((_, fail) => (reject = fail)));
    const { unmount } = render(<Storefront />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    unmount();
    reject(new Error("red caida"));
    await act(async () => undefined);

    expect(screen.queryByText(/No se pudo cargar/)).toBeNull();
  });

  it("exige montar el provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<HeaderConsumer />)).toThrow(
      "useStorefrontCatalogContext must be used inside StorefrontCatalogProvider",
    );
  });
});
