import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductType } from "@/core/enums";
import { PosTerminalPage } from "@/modules/pos/pages/PosTerminalPage";
import { id, ids } from "./posFixtures";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  terminal: {} as Record<string, unknown>,
}));

vi.mock("@/modules/pos/hooks/usePosTerminal", () => ({
  usePosTerminal: () => mocks.terminal,
}));
vi.mock("@/modules/pos/components/QuickProductList", () => ({
  QuickProductList: () => <div>Catálogo</div>,
}));
vi.mock("@/modules/pos/components/SaleTicket", () => ({
  SaleTicket: () => <div>Ticket</div>,
}));
vi.mock("@/modules/pos/components/CheckoutModal", () => ({
  CheckoutModal: () => null,
}));
vi.mock("@/modules/pos/components/PendingSaleBanner", () => ({
  PendingSaleBanner: () => null,
}));
vi.mock("@/modules/pos/components/PosSalesHistoryModal", () => ({
  PosSalesHistoryModal: () => null,
}));
vi.mock("@/modules/pos/components/PosTraceabilitySelector", () => ({
  PosTraceabilitySelector: ({
    open,
    product,
    onCancel,
    onConfirm,
  }: {
    open: boolean;
    product: { productId: string; requiredBaseQuantity: number } | null;
    onCancel: () => void;
    onConfirm: (selections: unknown[]) => void;
  }) =>
    open && product ? (
      <div>
        <p>{`${product.productId}:${product.requiredBaseQuantity}`}</p>
        <button type="button" onClick={onCancel}>Cancelar selector</button>
        <button type="button" onClick={() => onConfirm([])}>Confirmar selector</button>
      </div>
    ) : null,
}));

describe("PosTerminalPage trazabilidad", () => {
  beforeEach(() => {
    mocks.terminal = {
      pendingConfirmation: null,
      confirmationResult: null,
      products: [],
      filteredProducts: [],
      search: "",
      loading: false,
      error: null,
      ticketItems: [],
      subtotal: 0,
      discountTotal: 0,
      total: 0,
      ticketError: null,
      canOpenCheckout: false,
      checkoutOpen: false,
      checkout: {},
      checkoutErrors: {},
      availablePaymentModes: [],
      bankAccounts: [],
      traceabilityRequest: {
        requestedQuantity: 1,
        requiredBaseQuantity: 12,
        product: {
          productId: ids.product,
          sku: "TRZ-001",
          name: "Producto trazable",
          productType: ProductType.physical,
          requiresLot: true,
          requiresSerial: false,
          requiresExpiration: true,
          baseUnitId: id(50),
          saleUnitId: id(51),
        },
      },
      cancelTraceabilitySelection: mocks.cancel,
      confirmTraceabilitySelection: mocks.confirm,
    };
  });

  it("conecta la solicitud preparada con el selector y sus acciones", () => {
    render(<PosTerminalPage />);

    expect(screen.getByText(`${ids.product}:12`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar selector" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar selector" }));
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledWith([]);
  });
});
