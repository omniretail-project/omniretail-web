import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductType } from "@/core/enums";
import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";
import { QuickProductList } from "@/modules/pos/components/QuickProductList";
import { id, ids } from "./posFixtures";

const ordinary: PosProductDto = {
  productId: ids.product,
  sku: "POS-001",
  name: "Producto ordinario",
  productType: ProductType.physical,
  basePrice: 25,
  effectivePrice: 25,
  discount: 0,
  salesPriceTiers: [],
  availableQuantity: 10,
  baseUnitId: id(50),
  saleUnitId: id(50),
  saleUnitName: "Unidad",
  saleUnitToBaseFactor: 1,
  tracksStock: true,
  requiresLot: false,
  requiresSerial: false,
  requiresExpiration: false,
  requiresTraceabilitySelection: false,
  requiresUnsupportedTraceability: false,
  isAvailableForSale: true,
};

describe("QuickProductList trazabilidad", () => {
  it("conserva Agregar para productos ordinarios", () => {
    const onAdd = vi.fn();
    render(
      <QuickProductList
        error={null}
        hasProducts
        loading={false}
        products={[ordinary]}
        onAdd={onAdd}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onAdd).toHaveBeenCalledWith(ordinary);
  });

  it("ofrece seleccionar inventario para un producto trazable compatible", () => {
    const traceable = {
      ...ordinary,
      requiresLot: true,
      requiresExpiration: true,
      requiresTraceabilitySelection: true,
    };
    const onAdd = vi.fn();
    render(
      <QuickProductList
        error={null}
        hasProducts
        loading={false}
        products={[traceable]}
        onAdd={onAdd}
      />,
    );

    expect(screen.getByText(/Selecciona el inventario físico/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }));
    expect(onAdd).toHaveBeenCalledWith(traceable);
  });

  it("mantiene bloqueado un kit cuyo flujo de trazabilidad no está soportado", () => {
    const unsupportedKit = {
      ...ordinary,
      productType: ProductType.kit,
      requiresLot: true,
      requiresTraceabilitySelection: false,
      requiresUnsupportedTraceability: true,
      isAvailableForSale: false,
    };
    const onAdd = vi.fn();
    render(
      <QuickProductList
        error={null}
        hasProducts
        loading={false}
        products={[unsupportedKit]}
        onAdd={onAdd}
      />,
    );

    expect(screen.getByText("Este producto requiere un proceso de venta distinto.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No disponible" })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
