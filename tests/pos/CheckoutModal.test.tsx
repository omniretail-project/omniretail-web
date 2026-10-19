import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeliveryMethod, TransportMode } from "@/core/enums";
import type { SaleTicketItemDto } from "@/modules/pos/application/dto/SaleTicketDto";
import type { CheckoutDto } from "@/modules/pos/application/dto/CheckoutDto";
import { CheckoutModal } from "@/modules/pos/components/CheckoutModal";

const checkout: CheckoutDto = {
  documentType: "ticket",
  invoiceData: { taxId: "", legalName: "", fiscalAddress: "" },
  paymentMode: "cash",
  cashAmount: 50,
  cashReceived: 50,
  changeAmount: 0,
  cardAmount: 0,
  cardTerminalResult: { status: "idle" },
  transferAmount: 0,
  bankAccountId: "",
  transferReference: "",
  transferExternallyVerified: false,
  deliveryMethod: "",
  transportMode: TransportMode.none,
  notificationContact: { emailMode: "not_applicable" },
};

const traceableItem: SaleTicketItemDto = {
  productId: "00000000-0000-4000-8000-000000000001",
  sku: "TRZ-001",
  name: "Producto trazable",
  quantity: 1,
  baseUnitPrice: 50,
  unitPrice: 50,
  discount: 0,
  subtotal: 50,
  availableQuantity: 5,
  saleUnitId: "00000000-0000-4000-8000-000000000002",
  saleUnitName: "Unidad",
  tracksStock: true,
  requiresTraceabilitySelection: true,
  requiresLot: true,
  requiresSerial: true,
  requiresExpiration: true,
  requiresUnsupportedTraceability: false,
};

describe("CheckoutModal modalidad de entrega", () => {
  it("muestra la opción inicial vacía y comunica su validación", () => {
    const onCheckoutChange = vi.fn();
    render(
      <CheckoutModal
        appliedAmount={50}
        availablePaymentModes={[]}
        bankAccounts={[]}
        bankAccountsError={null}
        bankAccountsLoading={false}
        cashShiftError={null}
        cashShiftLoading={false}
        cashShiftRegisterCode="POS-01"
        checkout={checkout}
        confirmationError={null}
        confirmationLoading={false}
        currentBranchName="Centro"
        differenceAmount={0}
        discountTotal={0}
        errors={{ deliveryMethod: "Selecciona una modalidad de entrega." }}
        hasCurrentBranchAccess
        hasOpenCashShift
        hasOperationalBlock={false}
        hasPosSalesPermission
        hasUnsupportedTraceability={false}
        message={null}
        open
        paymentMethodsError={null}
        paymentMethodsLoading={false}
        readyToConfirm={false}
        subtotal={50}
        total={50}
        validated={false}
        onCheckoutChange={onCheckoutChange}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDeliveryAddressChange={vi.fn()}
        onDocumentTypeChange={vi.fn()}
        onInvoiceDataChange={vi.fn()}
        onPaymentModeChange={vi.fn()}
        onProcessCardPayment={vi.fn()}
        onReset={vi.fn()}
        onStorePickupContactChange={vi.fn()}
        onValidate={vi.fn()}
      />,
    );

    const deliverySection = screen.getByRole("heading", { name: "Entrega" }).closest("section");
    expect(deliverySection).not.toBeNull();
    if (!deliverySection) throw new Error("No se encontró la sección de entrega.");
    const deliveryMethod = within(deliverySection).getByRole("combobox", {
      name: "Modalidad",
    });
    expect(deliveryMethod).toHaveValue("");
    expect(screen.getByRole("option", { name: "Seleccione una opción" })).toBeInTheDocument();
    expect(screen.getByText("Selecciona una modalidad de entrega.")).toBeInTheDocument();

    fireEvent.change(deliveryMethod, { target: { value: DeliveryMethod.immediate } });
    expect(onCheckoutChange).toHaveBeenCalledWith({
      deliveryMethod: DeliveryMethod.immediate,
      transportMode: TransportMode.none,
    });
  });

  it("solicita inventario solo para líneas trazables de entrega inmediata", () => {
    const onSelectTraceability = vi.fn();
    const { rerender } = render(
      <CheckoutModal
        appliedAmount={50}
        availablePaymentModes={[]}
        bankAccounts={[]}
        bankAccountsError={null}
        bankAccountsLoading={false}
        cashShiftError={null}
        cashShiftLoading={false}
        cashShiftRegisterCode="POS-01"
        checkout={{ ...checkout, deliveryMethod: DeliveryMethod.immediate }}
        confirmationError={null}
        confirmationLoading={false}
        currentBranchName="Centro"
        differenceAmount={0}
        discountTotal={0}
        errors={{}}
        hasCurrentBranchAccess
        hasOpenCashShift
        hasOperationalBlock
        hasPosSalesPermission
        hasUnsupportedTraceability={false}
        message={null}
        open
        paymentMethodsError={null}
        paymentMethodsLoading={false}
        readyToConfirm={false}
        subtotal={50}
        ticketItems={[traceableItem]}
        total={50}
        validated={false}
        onCheckoutChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDeliveryAddressChange={vi.fn()}
        onDocumentTypeChange={vi.fn()}
        onInvoiceDataChange={vi.fn()}
        onPaymentModeChange={vi.fn()}
        onProcessCardPayment={vi.fn()}
        onReset={vi.fn()}
        onSelectTraceability={onSelectTraceability}
        onStorePickupContactChange={vi.fn()}
        onValidate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Seleccionar inventario" }));
    expect(onSelectTraceability).toHaveBeenCalledWith(traceableItem.productId);

    rerender(
      <CheckoutModal
        appliedAmount={50}
        availablePaymentModes={[]}
        bankAccounts={[]}
        bankAccountsError={null}
        bankAccountsLoading={false}
        cashShiftError={null}
        cashShiftLoading={false}
        cashShiftRegisterCode="POS-01"
        checkout={{ ...checkout, deliveryMethod: DeliveryMethod.immediate }}
        confirmationError={null}
        confirmationLoading={false}
        currentBranchName="Centro"
        differenceAmount={0}
        discountTotal={0}
        errors={{}}
        hasCurrentBranchAccess
        hasOpenCashShift
        hasOperationalBlock={false}
        hasPosSalesPermission
        hasUnsupportedTraceability={false}
        message={null}
        open
        paymentMethodsError={null}
        paymentMethodsLoading={false}
        readyToConfirm={false}
        subtotal={50}
        ticketItems={[
          {
            ...traceableItem,
            baseQuantity: 1,
            trackingSelections: [
              {
                productId: traceableItem.productId,
                locationId: "00000000-0000-4000-8000-000000000003",
                lotId: "00000000-0000-4000-8000-000000000004",
                quantity: 1,
                serialNumbers: ["SER-001"],
              },
            ],
            trackingSelectionSummary: [
              {
                locationId: "00000000-0000-4000-8000-000000000003",
                locationCode: "A-01",
                locationName: "Estante A",
                lotId: "00000000-0000-4000-8000-000000000004",
                lotNumber: "LOT-001",
                expirationDate: "2027-01-31",
                quantity: 1,
                serialNumbers: ["SER-001"],
              },
            ],
          },
        ]}
        total={50}
        validated={false}
        onCheckoutChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDeliveryAddressChange={vi.fn()}
        onDocumentTypeChange={vi.fn()}
        onInvoiceDataChange={vi.fn()}
        onPaymentModeChange={vi.fn()}
        onProcessCardPayment={vi.fn()}
        onReset={vi.fn()}
        onSelectTraceability={onSelectTraceability}
        onStorePickupContactChange={vi.fn()}
        onValidate={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Corregir selección" })).toBeInTheDocument();
    const savedSelection = screen.getByText("A-01 · Estante A").closest("li");
    expect(savedSelection).not.toBeNull();
    expect(savedSelection).toHaveTextContent("A-01 · Estante A · Lote LOT-001");
    expect(savedSelection).toHaveTextContent("vence 31/01/2027");
    expect(savedSelection).toHaveTextContent("1 unidades base");
    expect(screen.getByText("Series guardadas: SER-001")).toBeInTheDocument();

    rerender(
      <CheckoutModal
        appliedAmount={50}
        availablePaymentModes={[]}
        bankAccounts={[]}
        bankAccountsError={null}
        bankAccountsLoading={false}
        cashShiftError={null}
        cashShiftLoading={false}
        cashShiftRegisterCode="POS-01"
        checkout={{ ...checkout, deliveryMethod: DeliveryMethod.store_pickup }}
        confirmationError={null}
        confirmationLoading={false}
        currentBranchName="Centro"
        differenceAmount={0}
        discountTotal={0}
        errors={{}}
        hasCurrentBranchAccess
        hasOpenCashShift
        hasOperationalBlock={false}
        hasPosSalesPermission
        hasUnsupportedTraceability={false}
        message={null}
        open
        paymentMethodsError={null}
        paymentMethodsLoading={false}
        readyToConfirm={false}
        subtotal={50}
        ticketItems={[traceableItem]}
        total={50}
        validated={false}
        onCheckoutChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDeliveryAddressChange={vi.fn()}
        onDocumentTypeChange={vi.fn()}
        onInvoiceDataChange={vi.fn()}
        onPaymentModeChange={vi.fn()}
        onProcessCardPayment={vi.fn()}
        onReset={vi.fn()}
        onSelectTraceability={onSelectTraceability}
        onStorePickupContactChange={vi.fn()}
        onValidate={vi.fn()}
      />,
    );
    expect(screen.queryByText("Inventario físico")).not.toBeInTheDocument();
  });
});
