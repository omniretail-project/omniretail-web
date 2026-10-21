import { describe, expect, it, vi } from "vitest";
import { DeliveryMethod, TransportMode } from "@/core/enums";
import type { CheckoutDto } from "@/modules/pos/application/dto/CheckoutDto";
import type { SaleTicketDto } from "@/modules/pos/application/dto/SaleTicketDto";
import { ConfirmSaleService } from "@/modules/pos/application/services/ConfirmSaleService";
import { GetPosShippingQuoteService } from "@/modules/pos/application/services/GetPosShippingQuoteService";
import { createPosRepositories, id, ids } from "./posFixtures";

function ticket(): SaleTicketDto {
  return {
    items: [
      {
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
        requiresTraceabilitySelection: false,
        requiresLot: false,
        requiresSerial: false,
        requiresExpiration: false,
        requiresUnsupportedTraceability: false,
      },
    ],
    subtotal: 100,
    discountTotal: 0,
    total: 100,
    hasUnsupportedTraceability: false,
  };
}

function homeDeliveryCheckout(cashAmount: number): CheckoutDto {
  return {
    documentType: "ticket",
    invoiceData: { taxId: "", legalName: "", fiscalAddress: "" },
    paymentMode: "cash",
    cashAmount,
    cashReceived: cashAmount,
    changeAmount: 0,
    cardAmount: 0,
    cardTerminalResult: { status: "idle" },
    transferAmount: 0,
    bankAccountId: "",
    transferReference: "",
    transferExternallyVerified: false,
    deliveryMethod: DeliveryMethod.home_delivery,
    transportMode: TransportMode.own_fleet,
    deliveryAddress: {
      recipientName: "Ana López",
      recipientPhone: "55550101",
      line1: "6a avenida 1-23, zona 1",
      city: "Guatemala",
      country: "GT",
    },
    notificationContact: { emailMode: "not_applicable" },
  } as CheckoutDto;
}

function confirmInput(checkout: CheckoutDto, shippingTotal?: number) {
  return {
    confirmationId: ids.confirmation,
    branchId: ids.branch,
    cashShiftId: ids.shift,
    ticket: ticket(),
    checkout,
    orderIdempotencyKey: "order-attempt-1",
    shippingTotal,
  };
}

describe("ConfirmSaleService con envío a domicilio en modo API", () => {
  it("envía al backend pagos que cubren el ticket más el envío cotizado", async () => {
    const { repositories, posApi } = createPosRepositories();

    await new ConfirmSaleService(repositories).execute(confirmInput(homeDeliveryCheckout(115), 15));

    expect(posApi.confirmSale).toHaveBeenCalledTimes(1);
    expect(posApi.confirmSale.mock.calls[0]?.[0].payments).toEqual([
      expect.objectContaining({ amount: 115 }),
    ]);
  });

  it("rechaza antes del POST un cobro que no incluye el envío", async () => {
    const { repositories, posApi } = createPosRepositories();

    await expect(
      new ConfirmSaleService(repositories).execute(confirmInput(homeDeliveryCheckout(100), 15)),
    ).rejects.toThrow(/datos de pago/);
    expect(posApi.confirmSale).not.toHaveBeenCalled();
  });
});

describe("GetPosShippingQuoteService", () => {
  it("en modo API usa la cotización del backend", async () => {
    const { repositories, posApi } = createPosRepositories();
    posApi.getShippingQuote.mockResolvedValue({
      subtotal: 100,
      shippingTotal: 15,
      total: 115,
      freeShippingThreshold: 200,
    });

    const quote = await new GetPosShippingQuoteService(repositories).execute(100);

    expect(posApi.getShippingQuote).toHaveBeenCalledWith(100);
    expect(quote).toEqual({ shippingTotal: 15, freeShippingThreshold: 200 });
  });

  it("en modo mock calcula con la tarifa POS configurada del tenant", async () => {
    const shippingConfig = {
      get: vi.fn().mockResolvedValue({
        tenantId: ids.tenant,
        ecommerce: { enabled: true, deliveryFee: 25, freeShippingThreshold: 300 },
        pos: { enabled: true, deliveryFee: 15, freeShippingThreshold: 200 },
      }),
    };
    const { repositories, posApi } = createPosRepositories({
      extra: { posDataSource: "mock", shippingConfig },
    });
    const service = new GetPosShippingQuoteService(repositories);

    await expect(service.execute(100)).resolves.toEqual({
      shippingTotal: 15,
      freeShippingThreshold: 200,
    });
    await expect(service.execute(200)).resolves.toEqual({
      shippingTotal: 0,
      freeShippingThreshold: 200,
    });
    expect(shippingConfig.get).toHaveBeenCalledWith(ids.tenant);
    expect(posApi.getShippingQuote).not.toHaveBeenCalled();
  });

  it("en modo mock no cobra envío si el canal POS está desactivado", async () => {
    const shippingConfig = {
      get: vi.fn().mockResolvedValue({
        tenantId: ids.tenant,
        ecommerce: { enabled: true, deliveryFee: 25, freeShippingThreshold: 300 },
        pos: { enabled: false, deliveryFee: 15, freeShippingThreshold: 200 },
      }),
    };
    const { repositories } = createPosRepositories({
      extra: { posDataSource: "mock", shippingConfig },
    });

    await expect(new GetPosShippingQuoteService(repositories).execute(50)).resolves.toEqual({
      shippingTotal: 0,
      freeShippingThreshold: undefined,
    });
  });
});
