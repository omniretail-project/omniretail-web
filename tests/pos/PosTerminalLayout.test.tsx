import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";
import type { SaleTicketItemDto } from "@/modules/pos/application/dto/SaleTicketDto";
import { PosTerminalPage } from "@/modules/pos/pages/PosTerminalPage";
import { id, ids } from "./posFixtures";

const mocks = vi.hoisted(() => ({ terminal: {} as Record<string, unknown> }));

vi.mock("@/modules/pos/hooks/usePosTerminal", () => ({ usePosTerminal: () => mocks.terminal }));
// Los modales no forman parte del diseno de las dos columnas: se aislan.
vi.mock("@/modules/pos/components/CheckoutModal", () => ({ CheckoutModal: () => null }));
vi.mock("@/modules/pos/components/PendingSaleBanner", () => ({ PendingSaleBanner: () => null }));
vi.mock("@/modules/pos/components/PosTraceabilitySelector", () => ({ PosTraceabilitySelector: () => null }));
vi.mock("@/modules/pos/components/PosSalesHistoryModal", () => ({ PosSalesHistoryModal: () => null }));

function product(index: number): PosProductDto {
  return {
    productId: id(2000 + index),
    sku: `SKU-${index}`,
    barcode: null,
    name: `Catalogo ${index}`,
    basePrice: 10,
    effectivePrice: 10,
    discount: 0,
    tracksStock: true,
    availableQuantity: 100,
    saleUnitName: "Unidad",
    requiresUnsupportedTraceability: false,
    isAvailableForSale: true,
  } as unknown as PosProductDto;
}

function ticketItem(index: number): SaleTicketItemDto {
  return {
    productId: id(3000 + index),
    sku: `T-${index}`,
    name: `Articulo ${index}`,
    quantity: 1,
    baseUnitPrice: 10,
    unitPrice: 10,
    discount: 0,
    subtotal: 10,
    availableQuantity: 500,
    saleUnitId: ids.product,
    saleUnitName: "Unidad",
    tracksStock: true,
    requiresUnsupportedTraceability: false,
  };
}

describe("Terminal de Cobro: dos zonas de trabajo independientes", () => {
  const addProduct = vi.fn();
  const openCheckout = vi.fn();

  beforeEach(() => {
    addProduct.mockReset();
    openCheckout.mockReset();
    const products = Array.from({ length: 60 }, (_, index) => product(index));
    mocks.terminal = {
      search: "",
      setSearch: vi.fn(),
      error: null,
      loading: false,
      products,
      filteredProducts: products,
      addProduct,
      ticketItems: Array.from({ length: 100 }, (_, index) => ticketItem(index)),
      ticketError: null,
      canOpenCheckout: true,
      discountTotal: 0,
      subtotal: 1000,
      total: 1000,
      openCheckout,
      decreaseQuantity: vi.fn(),
      increaseQuantity: vi.fn(),
      setQuantity: vi.fn(),
      removeItem: vi.fn(),
      pendingConfirmation: null,
      confirmationResult: null,
    };
  });

  it("catalogo y lista del ticket tienen contenedores de scroll distintos y ninguno contiene al otro", () => {
    render(<PosTerminalPage />);
    const catalog = screen.getByTestId("catalog-scroll");
    const ticketList = screen.getByTestId("ticket-items");

    expect(catalog).not.toContainElement(ticketList);
    expect(ticketList).not.toContainElement(catalog);
    expect(within(catalog).getAllByRole("listitem")).toHaveLength(60);
    expect(within(ticketList).getAllByRole("listitem")).toHaveLength(100);
    expect(catalog.className).toContain("xl:overflow-y-auto");
    expect(ticketList.className).toContain("xl:overflow-y-auto");
  });

  it("Cobrar y los totales quedan fuera de ambos contenedores con scroll y siguen operando con 100 articulos", () => {
    render(<PosTerminalPage />);
    const cobrar = screen.getByRole("button", { name: "Cobrar" });

    expect(screen.getByTestId("catalog-scroll")).not.toContainElement(cobrar);
    expect(screen.getByTestId("ticket-items")).not.toContainElement(cobrar);
    expect(screen.getByTestId("ticket-summary")).toContainElement(cobrar);
    fireEvent.click(cobrar);
    expect(openCheckout).toHaveBeenCalledOnce();
  });

  it("agregar desde el catalogo no depende del scroll del ticket", () => {
    render(<PosTerminalPage />);

    fireEvent.click(within(screen.getByTestId("catalog-scroll")).getAllByRole("button", { name: "Agregar" })[0]!);

    expect(addProduct).toHaveBeenCalledWith(expect.objectContaining({ sku: "SKU-0" }));
  });

  it("la zona de trabajo se acota a la ventana solo en escritorio (xl) y apila en movil", () => {
    render(<PosTerminalPage />);
    const classes = screen.getByTestId("catalog-scroll").closest("section")!.className.split(/\s+/);

    expect(classes).toContain("xl:h-[calc(100dvh-14rem)]");
    expect(classes).toContain("xl:items-stretch");
    // Sin alto fijo ni scroll propio por debajo de xl.
    expect(classes.filter((token) => /^h-|^max-h-|^overflow/.test(token))).toEqual([]);
  });

  it("en movil ofrece un acceso directo al ticket que apunta a una ancla existente", () => {
    render(<PosTerminalPage />);
    const shortcut = screen.getByRole("link", { name: /Ir al ticket \(100\)/ });

    expect(shortcut).toHaveAttribute("href", "#pos-ticket");
    expect(shortcut.className).toContain("xl:hidden");
    expect(document.getElementById("pos-ticket")).not.toBeNull();
  });
});
