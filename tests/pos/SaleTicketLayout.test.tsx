import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaleTicketItemDto } from "@/modules/pos/application/dto/SaleTicketDto";
import { SaleTicket } from "@/modules/pos/components/SaleTicket";
import { id, ids } from "./posFixtures";

function ticketItem(index: number): SaleTicketItemDto {
  return {
    productId: id(1000 + index),
    sku: `POS-${index}`,
    name: `Producto ${index}`,
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

function renderTicket(count: number, overrides: Partial<Parameters<typeof SaleTicket>[0]> = {}) {
  const onCheckout = vi.fn();
  const view = render(
    <SaleTicket
      canCheckout
      discountTotal={0}
      error={null}
      items={Array.from({ length: count }, (_, index) => ticketItem(index))}
      subtotal={count * 10}
      total={count * 10}
      onCheckout={onCheckout}
      onDecrease={vi.fn()}
      onIncrease={vi.fn()}
      onQuantityChange={vi.fn()}
      onRemove={vi.fn()}
      {...overrides}
    />,
  );
  return {
    ...view,
    onCheckout,
    aside: screen.getByRole("complementary"),
    items: screen.getByTestId("ticket-items"),
    summary: screen.getByTestId("ticket-summary"),
  };
}

describe("SaleTicket con tickets extensos", () => {
  it("el boton Cobrar sigue funcionando con 150 articulos", () => {
    const { onCheckout } = renderTicket(150);

    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));

    expect(onCheckout).toHaveBeenCalledOnce();
  });

  it("la lista de articulos tiene su propio contenedor con scroll y contiene todos los articulos", () => {
    const { items } = renderTicket(150);

    expect(within(items).getAllByRole("listitem")).toHaveLength(150);
    const classes = items.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["min-h-0", "flex-1", "xl:overflow-y-auto", "xl:overscroll-contain"]));
  });

  it("totales y Cobrar estan en un pie fuera de la lista que se desplaza", () => {
    const { items, summary } = renderTicket(150);
    const cobrar = screen.getByRole("button", { name: "Cobrar" });

    expect(summary).toContainElement(cobrar);
    expect(items).not.toContainElement(cobrar);
    for (const label of ["Subtotal", "Descuentos", "Total"]) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
      expect(items).not.toContainElement(screen.getByText(label));
    }
    expect(summary).toHaveTextContent(/1,?500/);
  });

  it("el pie no se desplaza en escritorio y queda adherido abajo en movil sin ser fixed", () => {
    const { summary } = renderTicket(150);
    const classes = summary.className.split(/\s+/);

    expect(classes).toEqual(expect.arrayContaining(["sticky", "bottom-0", "xl:static", "shrink-0"]));
    expect(classes).not.toContain("fixed");
    expect(summary.innerHTML).toContain("safe-area-inset-bottom");
  });

  it("la columna llena el alto de la zona de trabajo en escritorio sin romper el sticky en movil", () => {
    const { aside } = renderTicket(5);
    const classes = aside.className.split(/\s+/);

    expect(classes).toEqual(expect.arrayContaining(["flex", "flex-col", "min-h-0", "xl:h-full", "xl:overflow-hidden"]));
    // `overflow-hidden` sin prefijo anularia el `sticky` del pie en movil y tablet.
    expect(classes).not.toContain("overflow-hidden");
    expect(aside).toHaveAttribute("id", "pos-ticket");
  });

  it("el contador del encabezado refleja la cantidad de articulos", () => {
    renderTicket(150);

    expect(screen.getByText("150 productos")).toBeInTheDocument();
  });

  it("un error de ticket se muestra fuera de la lista con scroll", () => {
    const { items } = renderTicket(3, { error: "Stock insuficiente" });

    const message = screen.getByText("Stock insuficiente");
    expect(items).not.toContainElement(message);
  });

  it("con el ticket vacio muestra el aviso dentro del contenedor y bloquea Cobrar segun canCheckout", () => {
    const { items } = renderTicket(0, { canCheckout: false });

    expect(within(items).getByText("Tu ticket está vacío")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeDisabled();
  });
});
