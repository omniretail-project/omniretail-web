import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaleTicketItemDto } from "@/modules/pos/application/dto/SaleTicketDto";
import { SaleTicket } from "@/modules/pos/components/SaleTicket";
import { id, ids } from "./posFixtures";

const item: SaleTicketItemDto = {
  productId: ids.product,
  sku: "POS-001",
  name: "Producto POS",
  quantity: 2,
  baseUnitPrice: 50,
  unitPrice: 50,
  discount: 0,
  subtotal: 100,
  availableQuantity: 10,
  saleUnitId: id(50),
  saleUnitName: "Unidad",
  tracksStock: true,
  requiresUnsupportedTraceability: false,
};

function renderTicket(onQuantityChange = vi.fn()) {
  render(
    <SaleTicket
      canCheckout
      discountTotal={0}
      error={null}
      items={[item]}
      subtotal={100}
      total={100}
      onCheckout={vi.fn()}
      onDecrease={vi.fn()}
      onIncrease={vi.fn()}
      onQuantityChange={onQuantityChange}
      onRemove={vi.fn()}
    />,
  );
  return {
    input: screen.getByRole("textbox", { name: `Cantidad de ${item.name}` }),
    onQuantityChange,
  };
}

describe("SaleTicket cantidad editable", () => {
  it("cancela con Escape y el blur posterior no confirma", () => {
    const { input, onQuantityChange } = renderTicket();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "7" } });

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(input).toHaveValue("2");
    expect(onQuantityChange).not.toHaveBeenCalled();
  });

  it("restaura silenciosamente un campo vacio", () => {
    const { input, onQuantityChange } = renderTicket();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });

    fireEvent.blur(input);

    expect(input).toHaveValue("2");
    expect(onQuantityChange).not.toHaveBeenCalled();
  });

  it("restaura silenciosamente un cero", () => {
    const { input, onQuantityChange } = renderTicket();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "0" } });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveValue("2");
    expect(onQuantityChange).not.toHaveBeenCalled();
  });

  it("confirma una cantidad valida con Enter", () => {
    const { input, onQuantityChange } = renderTicket();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "6" } });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onQuantityChange).toHaveBeenCalledOnce();
    expect(onQuantityChange).toHaveBeenCalledWith(item.productId, 6);
  });

  it("confirma una cantidad valida al perder el foco", () => {
    const { input, onQuantityChange } = renderTicket();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "4" } });

    fireEvent.blur(input);

    expect(onQuantityChange).toHaveBeenCalledOnce();
    expect(onQuantityChange).toHaveBeenCalledWith(item.productId, 4);
  });
});
