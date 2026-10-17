import { describe, expect, it, vi } from "vitest";
import {
  DeliveryMethod,
  OrderStatus,
  PaymentMethod,
  ProductType,
  PromotionStatus,
  PromotionType,
  SaleStatus,
  SalesChannel,
  TransportMode,
} from "@/core/enums";
import type { CheckoutDto } from "@/modules/pos/application/dto/CheckoutDto";
import type { SaleTicketDto } from "@/modules/pos/application/dto/SaleTicketDto";
import {
  mapApiReturnResult,
  mapApiVoidResult,
} from "@/modules/pos/application/mappers/SaleReversalResultMapper";
import { ConfirmSaleService } from "@/modules/pos/application/services/ConfirmSaleService";
import { GetPosProductsService } from "@/modules/pos/application/services/GetPosProductsService";
import { GetPosSalesHistoryService } from "@/modules/pos/application/services/GetPosSalesHistoryService";
import { GetReturnSaleLookupService } from "@/modules/pos/application/services/GetReturnSaleLookupService";
import { ProcessSaleReturnService } from "@/modules/pos/application/services/ProcessSaleReturnService";
import { VoidSaleService } from "@/modules/pos/application/services/VoidSaleService";
import {
  apiHistoryPage,
  apiReturnEligibility,
  apiReversalEffect,
  apiSaleDetail,
  apiVoidResult,
  at,
  createPosRepositories,
  id,
  ids,
} from "./posFixtures";

const returnContext = { tenantId: ids.tenant, branchId: ids.branch, actorUserId: ids.user };

function ticket(overrides: Partial<SaleTicketDto> = {}): SaleTicketDto {
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
        requiresUnsupportedTraceability: false,
      },
    ],
    subtotal: 100,
    discountTotal: 0,
    total: 100,
    hasUnsupportedTraceability: false,
    ...overrides,
  };
}

function checkout(overrides: Partial<CheckoutDto> = {}): CheckoutDto {
  return {
    documentType: "ticket",
    invoiceData: { taxId: "", legalName: "", fiscalAddress: "" },
    paymentMode: "cash",
    cashAmount: 100,
    cashReceived: 100,
    changeAmount: 0,
    cardAmount: 0,
    cardTerminalResult: { status: "idle" },
    transferAmount: 0,
    bankAccountId: "",
    transferReference: "",
    transferExternallyVerified: false,
    deliveryMethod: DeliveryMethod.immediate,
    transportMode: TransportMode.none,
    notificationContact: { emailMode: "not_applicable" },
    ...overrides,
  } as CheckoutDto;
}

function confirmInput(overrides: Record<string, unknown> = {}) {
  return {
    confirmationId: ids.confirmation,
    branchId: ids.branch,
    cashShiftId: ids.shift,
    ticket: ticket(),
    checkout: checkout(),
    ...overrides,
  };
}

describe("ConfirmSaleService en modo API", () => {
  it("confirma una venta en efectivo con el contrato real y devuelve el resultado del backend", async () => {
    const { repositories, posApi } = createPosRepositories();

    const result = await new ConfirmSaleService(repositories).execute(confirmInput());

    expect(result).toEqual({
      sale: { id: ids.sale, number: "V-100", total: 100, sourceOrderId: undefined },
      payments: [{ currency: "GTQ" }],
      inventoryMovements: [{ id: ids.inventoryMovement }],
      idempotent: false,
    });
    expect(posApi.confirmSale).toHaveBeenCalledWith({
      branchId: ids.branch,
      cashShiftId: ids.shift,
      customerId: undefined,
      taxTotal: 0,
      items: [{ productId: ids.product, quantity: 2, discount: 0, trackingSelections: [] }],
      payments: [
        {
          method: PaymentMethod.cash,
          amount: 100,
          bankAccountId: undefined,
          reference: undefined,
          externallyVerified: undefined,
        },
      ],
      confirmationId: ids.confirmation,
      document: { type: "ticket" },
      sourceOrderId: null,
      deferredOrder: undefined,
    });
  });

  it("envía el pedido de retiro en tienda con el contacto recortado y la clave de pedido", async () => {
    const { repositories, posApi } = createPosRepositories();

    await new ConfirmSaleService(repositories).execute(
      confirmInput({
        orderIdempotencyKey: " order-attempt-1 ",
        checkout: checkout({
          deliveryMethod: DeliveryMethod.store_pickup,
          transportMode: TransportMode.customer,
          storePickupContact: { recipientName: " Ana López ", recipientPhone: " 55550101 " },
        }),
      }),
    );

    expect(posApi.confirmSale.mock.calls[0]?.[0].deferredOrder).toEqual({
      idempotencyKey: "order-attempt-1",
      deliveryMethod: DeliveryMethod.store_pickup,
      transportMode: TransportMode.customer,
      notificationContact: undefined,
      deliveryAddress: undefined,
      storePickupContact: { recipientName: "Ana López", recipientPhone: "55550101" },
    });
  });

  it("valida la cuenta bancaria y envía la verificación externa de la transferencia", async () => {
    const { repositories, posApi, raw } = createPosRepositories();

    await new ConfirmSaleService(repositories).execute(
      confirmInput({
        checkout: checkout({
          paymentMode: "mixed",
          cashAmount: 20,
          cashReceived: 20,
          cardAmount: 30,
          cardTerminalResult: { status: "approved", reference: "AUTH-123456", authorizedAmount: 30 },
          transferAmount: 50,
          bankAccountId: ids.bankAccount,
          transferReference: " TRX-300 ",
          transferExternallyVerified: true,
        }),
      }),
    );

    expect(raw.bankAccounts.getById).toHaveBeenCalledWith(ids.bankAccount);
    expect(posApi.confirmSale.mock.calls[0]?.[0].payments).toEqual([
      expect.objectContaining({ method: PaymentMethod.cash, amount: 20 }),
      expect.objectContaining({ method: PaymentMethod.card, amount: 30, reference: "AUTH-123456" }),
      expect.objectContaining({
        method: PaymentMethod.transfer,
        amount: 50,
        bankAccountId: ids.bankAccount,
        reference: "TRX-300",
        externallyVerified: true,
      }),
    ]);
  });

  it.each([
    ["sin pedido de origen en modo API", { sourceOrderId: ids.order }, "pedidos existentes"],
    ["ticket vacío", { ticket: ticket({ items: [], total: 0 }) }, "El ticket está vacío."],
    ["sin confirmationId", { confirmationId: "  " }, "intento de confirmación"],
    ["trazabilidad no soportada", { ticket: ticket({ hasUnsupportedTraceability: true }) }, "lote, serial o kit"],
    [
      "pedido diferido sin clave",
      {
        checkout: checkout({
          deliveryMethod: DeliveryMethod.store_pickup,
          storePickupContact: { recipientName: "Ana", recipientPhone: "55550101" },
        }),
      },
      "intento de pedido diferido",
    ],
    ["pago que no cubre el total", { checkout: checkout({ cashAmount: 80, cashReceived: 80 }) }, "revisarse"],
  ])("rechaza %s sin llamar al backend", async (_label, overrides, message) => {
    const { repositories, posApi } = createPosRepositories();
    await expect(
      new ConfirmSaleService(repositories).execute(confirmInput(overrides)),
    ).rejects.toThrow(message);
    expect(posApi.confirmSale).not.toHaveBeenCalled();
  });

  it("rechaza métodos de pago no habilitados y cuentas bancarias inválidas", async () => {
    const cashOnly = createPosRepositories({ allowedPosPaymentMethods: [PaymentMethod.card] });
    await expect(new ConfirmSaleService(cashOnly.repositories).execute(confirmInput())).rejects.toThrow();
    expect(cashOnly.posApi.confirmSale).not.toHaveBeenCalled();

    const badAccount = createPosRepositories();
    badAccount.raw.bankAccounts.getById.mockResolvedValueOnce(null);
    await expect(
      new ConfirmSaleService(badAccount.repositories).execute(
        confirmInput({
          checkout: checkout({
            paymentMode: "transfer",
            cashAmount: 0,
            cashReceived: 0,
            transferAmount: 100,
            bankAccountId: ids.bankAccount,
            transferReference: "TRX-1",
            transferExternallyVerified: true,
          }),
        }),
      ),
    ).rejects.toThrow("La cuenta bancaria ya no está activa");
    expect(badAccount.posApi.confirmSale).not.toHaveBeenCalled();
  });

  it("exige sesión, permiso de venta y turno de caja vigente", async () => {
    const noSession = createPosRepositories({ sessionId: null });
    await expect(new ConfirmSaleService(noSession.repositories).execute(confirmInput())).rejects.toThrow(
      "No existe una sesión activa.",
    );

    const noPermission = createPosRepositories({ role: { permissions: ["pos.sales.read"] } });
    await expect(
      new ConfirmSaleService(noPermission.repositories).execute(confirmInput()),
    ).rejects.toThrow("No dispone de permisos para crear ventas POS.");

    const noShift = createPosRepositories();
    noShift.posApi.getOpenCashShift.mockResolvedValue(null);
    await expect(new ConfirmSaleService(noShift.repositories).execute(confirmInput())).rejects.toThrow(
      "No hay un turno de caja abierto y vigente para esta sucursal.",
    );
    expect(noShift.posApi.confirmSale).not.toHaveBeenCalled();
  });

  it("bloquea los kits en ventas diferidas antes de llamar al backend", async () => {
    const kitTicket = ticket({
      items: [{ ...ticket().items[0]!, isKit: true, name: "Kit Hogar" }],
    });
    for (const deliveryMethod of [DeliveryMethod.store_pickup, DeliveryMethod.home_delivery]) {
      const { repositories, posApi } = createPosRepositories();

      await expect(
        new ConfirmSaleService(repositories).execute(
          confirmInput({
            ticket: kitTicket,
            checkout: checkout({
              deliveryMethod,
              transportMode:
                deliveryMethod === DeliveryMethod.store_pickup
                  ? TransportMode.customer
                  : TransportMode.own_fleet,
            }),
          }),
        ),
      ).rejects.toThrow("Kit Hogar: Los kits solo se pueden vender con entrega inmediata.");
      expect(posApi.confirmSale).not.toHaveBeenCalled();
    }
  });

  it("permite vender un kit con entrega inmediata", async () => {
    const { repositories, posApi } = createPosRepositories();
    const kitTicket = ticket({ items: [{ ...ticket().items[0]!, isKit: true }] });

    await new ConfirmSaleService(repositories).execute(confirmInput({ ticket: kitTicket }));

    expect(posApi.confirmSale).toHaveBeenCalledTimes(1);
  });

  it("propaga el rechazo del backend sin inventar una venta", async () => {
    const { repositories, posApi } = createPosRepositories();
    posApi.confirmSale.mockRejectedValueOnce(new Error("Stock insuficiente"));
    await expect(new ConfirmSaleService(repositories).execute(confirmInput())).rejects.toThrow(
      "Stock insuficiente",
    );
  });
});

describe("GetPosProductsService en modo API", () => {
  const unitId = id(60);
  const otherUnit = id(61);
  const product = (index: number, extra: Record<string, unknown> = {}) => ({
    id: id(100 + index),
    tenantId: ids.tenant,
    sku: `SKU-${index}`,
    name: `Producto ${index}`,
    productType: ProductType.physical,
    salePrice: 100,
    baseUnitId: unitId,
    saleUnitId: unitId,
    tracking: { stock: true, lot: false, serial: false, expiration: false },
    ...extra,
  });

  function catalogRepositories(products: ReturnType<typeof product>[]) {
    const calls = { applicable: vi.fn(), conversionsByProduct: vi.fn() };
    const { repositories } = createPosRepositories({
      extra: {
        inventoryStockDataSource: "api",
        products: { getAvailableForPos: vi.fn().mockResolvedValue(products) },
        inventory: {
          getStockPage: vi
            .fn()
            .mockResolvedValueOnce({
              items: [{ productId: products[0]!.id, productType: ProductType.physical, availableQuantity: 5 }],
              totalPages: 2,
            })
            .mockResolvedValueOnce({
              items: [{ productId: products[1]!.id, productType: ProductType.physical, availableQuantity: 0 }],
              totalPages: 2,
            }),
        },
        units: {
          getByTenant: vi.fn().mockResolvedValue([{ id: unitId, name: "Unidad" }]),
          getAllConversionsByTenant: vi.fn().mockResolvedValue([
            { productId: products[0]!.id, fromUnitId: unitId, toUnitId: unitId, factor: 1 },
            { productId: null, fromUnitId: unitId, toUnitId: otherUnit, factor: 12 },
          ]),
          getConversionsByProductScoped: calls.conversionsByProduct,
        },
        promotions: {
          getActiveByTenant: vi.fn().mockResolvedValue([
            {
              id: id(70),
              tenantId: ids.tenant,
              name: "10%",
              type: PromotionType.percentage,
              value: 10,
              channels: [SalesChannel.pos],
              startAt: "2020-01-01T00:00:00.000Z",
              untilStockEnds: false,
              branchIds: [],
              productIds: [products[0]!.id],
              status: PromotionStatus.active,
              createdAt: at,
              updatedAt: at,
            },
          ]),
          getApplicable: calls.applicable,
        },
        productSalesPriceTiers: {
          getByProduct: vi.fn().mockResolvedValue([
            { tenantId: ids.tenant, productId: products[0]!.id, minQuantity: 10, unitPrice: 80, active: true },
            { tenantId: ids.tenant, productId: products[0]!.id, minQuantity: 20, unitPrice: 70, active: false },
          ]),
        },
      },
    });
    return { repositories, calls };
  }

  it("arma el catálogo con stock, promociones y conversiones cargados una sola vez", async () => {
    const products = [
      product(1),
      product(2),
      product(3, { productType: ProductType.service, tracking: { stock: false, lot: false, serial: false, expiration: false } }),
      product(4, { tracking: { stock: true, lot: true, serial: false, expiration: false } }),
      product(5, { saleUnitId: otherUnit }),
    ];
    const { repositories, calls } = catalogRepositories(products);

    const result = await new GetPosProductsService(repositories).execute({
      tenantId: ids.tenant,
      branchId: ids.branch,
    });
    const byId = new Map(result.map((item) => [item.productId, item]));

    expect(calls.applicable).not.toHaveBeenCalled();
    expect(calls.conversionsByProduct).not.toHaveBeenCalled();
    expect(byId.get(products[0]!.id)).toMatchObject({
      effectivePrice: 90,
      availableQuantity: 5,
      isAvailableForSale: true,
      salesPriceTiers: [{ minQuantity: 10, unitPrice: 80, active: true }],
      saleUnitName: "Unidad",
    });
    expect(byId.get(products[1]!.id)).toMatchObject({ effectivePrice: 100, isAvailableForSale: false });
    expect(byId.get(products[2]!.id)).toMatchObject({ availableQuantity: null, isAvailableForSale: true });
    expect(byId.get(products[3]!.id)).toMatchObject({
      requiresUnsupportedTraceability: true,
      isAvailableForSale: false,
    });
    expect(byId.get(products[4]!.id)).toMatchObject({ availableQuantity: 0, isAvailableForSale: false });
    expect(result.map((item) => item.name)).toEqual([...result.map((item) => item.name)].sort());
  });
});

describe("GetPosSalesHistoryService en modo API", () => {
  it("pide solo la página visible al backend, con su total y resumen, sin detalles", async () => {
    const { repositories, posApi } = createPosRepositories();
    posApi.getSalesHistory.mockResolvedValueOnce(
      apiHistoryPage({
        page: 1,
        pageSize: 10,
        totalItems: 480,
        totalPages: 48,
        summary: { total: 480, completed: 470, partiallyReturned: 4, returned: 2, cancelled: 4 },
      }),
    );

    const result = await new GetPosSalesHistoryService(repositories).execute({
      actorUserId: ids.user,
      branchId: ids.branch,
      filters: { search: "V-1" },
    });

    expect(posApi.getSalesHistory).toHaveBeenCalledTimes(1);
    expect(posApi.getSalesHistory).toHaveBeenCalledWith({
      branchId: ids.branch,
      search: "V-1",
      from: undefined,
      to: undefined,
      status: undefined,
      deliveryMethod: undefined,
      operationalStatus: undefined,
      page: 1,
      pageSize: 10,
    });
    expect(posApi.getSaleDetail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ page: 1, pageSize: 10, totalItems: 480, totalPages: 48 });
    expect(result.summary).toEqual({ total: 480, active: 470, partiallyReturned: 4, returned: 2, cancelled: 4 });
    const pickup = result.sales.find((sale) => sale.saleId === ids.sale);
    expect(pickup).toMatchObject({
      documentNumber: "V-100",
      deliveryMethod: DeliveryMethod.store_pickup,
      orderStatus: OrderStatus.ready_for_pickup,
      operationalStatusLabel: "Listo para retiro",
    });
    expect(pickup).not.toHaveProperty("payments");
  });

  it("pide la página solicitada y acota el tamaño de página", async () => {
    const { repositories, posApi } = createPosRepositories();
    posApi.getSalesHistory.mockResolvedValueOnce(
      apiHistoryPage({
        page: 3,
        pageSize: 100,
        totalItems: 250,
        totalPages: 3,
        items: [
          {
            saleId: id(80),
            saleNumber: "V-101",
            createdAt: at,
            customerDisplayName: "Consumidor final",
            total: 20,
            status: SaleStatus.cancelled,
          },
        ],
      }),
    );

    const result = await new GetPosSalesHistoryService(repositories).execute({
      actorUserId: ids.user,
      branchId: ids.branch,
      page: 3,
      pageSize: 500,
    });

    expect(posApi.getSalesHistory).toHaveBeenCalledTimes(1);
    expect(posApi.getSalesHistory).toHaveBeenCalledWith(expect.objectContaining({ page: 3, pageSize: 100 }));
    expect(result).toMatchObject({ page: 3, totalPages: 3, totalItems: 250 });
    expect(result.sales[0]).toMatchObject({
      saleId: id(80),
      deliveryMethodLabel: "No disponible",
      operationalStatusLabel: "—",
    });
  });

  it("conserva una venta que el backend encontró por el número de su pedido", async () => {
    const { repositories, posApi } = createPosRepositories();
    // La fila no contiene el número de pedido: solo el backend puede saber que coincide.
    posApi.getSalesHistory.mockResolvedValueOnce(apiHistoryPage());

    const result = await new GetPosSalesHistoryService(repositories).execute({
      actorUserId: ids.user,
      branchId: ids.branch,
      filters: { search: "ORD-100" },
    });

    expect(posApi.getSalesHistory).toHaveBeenCalledWith(expect.objectContaining({ search: "ORD-100" }));
    expect(result.sales.map((sale) => sale.saleId)).toEqual([ids.sale]);
  });

  it("no descarta por fecha ventas que el backend incluyó con la zona horaria del negocio", async () => {
    const { repositories, posApi } = createPosRepositories();
    // 01:30 UTC del 10 de octubre sigue siendo 9 de octubre en Guatemala.
    posApi.getSalesHistory.mockResolvedValueOnce(
      apiHistoryPage({
        items: [{ ...apiHistoryPage().items[0]!, createdAt: "2026-10-10T01:30:00.000Z" }],
      }),
    );

    const result = await new GetPosSalesHistoryService(repositories).execute({
      actorUserId: ids.user,
      branchId: ids.branch,
      filters: { dateFrom: "2026-10-09", dateTo: "2026-10-09" },
    });

    expect(result.sales).toHaveLength(1);
  });

  it("resuelve en el backend el filtro operativo de ventas inmediatas", async () => {
    const { repositories, posApi } = createPosRepositories();

    await new GetPosSalesHistoryService(repositories).execute({
      actorUserId: ids.user,
      branchId: ids.branch,
      filters: { operationalStatus: "immediate" },
    });

    expect(posApi.getSalesHistory).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryMethod: DeliveryMethod.immediate, operationalStatus: undefined }),
    );
  });

  it.each([
    ["pedido de origen no disponible", { operationalStatus: "unavailable" as const }],
    ["modalidad no disponible", { deliveryMethod: "unavailable" as const }],
    [
      "inmediata con retiro en tienda",
      { operationalStatus: "immediate" as const, deliveryMethod: DeliveryMethod.store_pickup },
    ],
  ])("responde vacío sin filtrar una página parcial: %s", async (_label, filters) => {
    const { repositories, posApi } = createPosRepositories();

    const result = await new GetPosSalesHistoryService(repositories).execute({
      actorUserId: ids.user,
      branchId: ids.branch,
      filters,
    });

    expect(posApi.getSalesHistory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sales: [], totalItems: 0, totalPages: 1, page: 1 });
  });

  it("carga el detalle de una sola venta al seleccionarla", async () => {
    const { repositories, posApi } = createPosRepositories();
    const service = new GetPosSalesHistoryService(repositories);
    const [row] = (await service.execute({ actorUserId: ids.user, branchId: ids.branch })).sales;

    const sale = await service.getSaleDetail({ actorUserId: ids.user, branchId: ids.branch, sale: row! });

    expect(posApi.getSaleDetail).toHaveBeenCalledTimes(1);
    expect(posApi.getSaleDetail).toHaveBeenCalledWith(ids.sale);
    expect(sale).toMatchObject({
      saleId: ids.sale,
      customerDisplayName: "Cliente POS",
      documentType: "invoice",
      taxId: "1234567-8",
      paymentSummary: "Efectivo",
    });
    expect(sale.payments[0]).toMatchObject({ method: PaymentMethod.cash, amount: 100 });
    expect(sale.items[0]).toMatchObject({ sku: "POS-001", quantity: 2 });

    const again = await service.getSaleDetail({ actorUserId: ids.user, branchId: ids.branch, sale });
    expect(again).toBe(sale);
    expect(posApi.getSaleDetail).toHaveBeenCalledTimes(1);
  });

  it("el detalle sin pagos muestra 'No disponible' y exige permiso de consulta", async () => {
    const { repositories, posApi } = createPosRepositories();
    posApi.getSaleDetail.mockResolvedValueOnce({ ...apiSaleDetail, payments: [] });
    const service = new GetPosSalesHistoryService(repositories);
    const [row] = (await service.execute({ actorUserId: ids.user, branchId: ids.branch })).sales;

    const sale = await service.getSaleDetail({ actorUserId: ids.user, branchId: ids.branch, sale: row! });
    expect(sale.paymentSummary).toBe("No disponible");

    const noPermission = createPosRepositories({ role: { permissions: ["pos.cash.read"] } });
    await expect(
      new GetPosSalesHistoryService(noPermission.repositories).getSaleDetail({
        actorUserId: ids.user,
        branchId: ids.branch,
        sale: row!,
      }),
    ).rejects.toThrow("No dispone de permisos para consultar el historial de ventas.");
    expect(noPermission.posApi.getSaleDetail).not.toHaveBeenCalled();
  });

  it("en modo mock una fila incompleta no se completa contra la API", async () => {
    const { repositories } = createPosRepositories({ extra: { posDataSource: "mock" } });
    await expect(
      new GetPosSalesHistoryService(repositories).getSaleDetail({
        actorUserId: ids.user,
        branchId: ids.branch,
        sale: {
          saleId: ids.sale,
          documentNumber: "V-100",
          createdAt: at,
          customerDisplayName: "Cliente",
          total: 10,
          saleStatus: SaleStatus.completed,
          saleStatusLabel: "Completada",
          saleStatusTone: "success",
          deliveryMethodLabel: "Entrega inmediata",
          operationalStatusLabel: "—",
          operationalStatusTone: "neutral",
          hasUnavailableOrder: false,
        },
      }),
    ).rejects.toThrow("No se pudo cargar el detalle de la venta V-100.");
  });

  it("envía al backend los filtros concretos de estado, entrega y fechas", async () => {
    const { repositories, posApi } = createPosRepositories();
    await new GetPosSalesHistoryService(repositories).execute({
      actorUserId: ids.user,
      branchId: ids.branch,
      filters: {
        dateFrom: "2026-10-01",
        dateTo: "2026-10-09",
        saleStatus: SaleStatus.completed,
        deliveryMethod: DeliveryMethod.store_pickup,
        operationalStatus: OrderStatus.ready_for_pickup,
      },
    });
    expect(posApi.getSalesHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-10-01",
        to: "2026-10-09",
        status: SaleStatus.completed,
        deliveryMethod: DeliveryMethod.store_pickup,
        operationalStatus: OrderStatus.ready_for_pickup,
      }),
    );
  });

  it("en modo mock pagina en el cliente sobre las ventas filtradas", async () => {
    const sale = (index: number) => ({
      id: id(200 + index),
      tenantId: ids.tenant,
      branchId: ids.branch,
      number: `V-${String(index).padStart(3, "0")}`,
      status: SaleStatus.completed,
      total: 10,
      createdAt: at,
      items: [],
    });
    const { repositories } = createPosRepositories({
      extra: {
        posDataSource: "mock",
        sales: { listByBranch: vi.fn().mockResolvedValue(Array.from({ length: 23 }, (_, index) => sale(index))) },
        orders: { getByIdsScoped: vi.fn().mockResolvedValue([]) },
        payments: { getBySaleScoped: vi.fn().mockResolvedValue([]) },
      },
    });

    const result = await new GetPosSalesHistoryService(repositories).execute({
      actorUserId: ids.user,
      branchId: ids.branch,
      page: 3,
      pageSize: 10,
    });

    expect(result).toMatchObject({ page: 3, pageSize: 10, totalItems: 23, totalPages: 3 });
    expect(result.sales.map((item) => item.documentNumber)).toEqual(["V-020", "V-021", "V-022"]);
    expect(result.summary.total).toBe(23);
  });

  it("falla con un mensaje claro si la integración API no está configurada", async () => {
    const { repositories } = createPosRepositories({ extra: { posApi: undefined } });
    await expect(
      new GetPosSalesHistoryService(repositories).execute({ actorUserId: ids.user, branchId: ids.branch }),
    ).rejects.toThrow("La integración API de POS no está disponible.");
  });
});

describe("devoluciones y anulaciones en modo API", () => {
  it("GetReturnSaleLookup traduce la elegibilidad del backend al DTO de pantalla", async () => {
    const { repositories, posApi } = createPosRepositories();

    const lookup = await new GetReturnSaleLookupService(repositories).execute({
      ...returnContext,
      documentNumber: " V-100 ",
    });

    expect(posApi.getReturnEligibility).toHaveBeenCalledWith(ids.branch, "V-100");
    expect(lookup).toMatchObject({
      sale: { saleId: ids.sale, documentNumber: "V-100", customerDisplayName: "Consumidor final" },
      paymentSummary: `${PaymentMethod.cash} + ${PaymentMethod.card}`,
      isWithinCurrentShift: true,
      allowedOperations: { voidTotal: true, partialReturn: true },
    });
    expect(lookup?.returnableItems).toHaveLength(1);
    expect(lookup?.payments[0]).toEqual({
      paymentId: ids.paymentCash,
      method: PaymentMethod.cash,
      amount: 20,
      status: apiReturnEligibility.payments[0]!.status,
    });
  });

  it("GetReturnSaleLookup devuelve null si la venta no existe y exige documento", async () => {
    const { repositories, posApi } = createPosRepositories();
    posApi.getReturnEligibility.mockResolvedValueOnce(null);
    const service = new GetReturnSaleLookupService(repositories);

    expect(await service.execute({ ...returnContext, documentNumber: "V-999" })).toBeNull();
    await expect(service.execute({ ...returnContext, documentNumber: "  " })).rejects.toThrow(
      "El numero de documento es requerido.",
    );
  });

  it("ProcessSaleReturn envía líneas sin trazabilidad con la clave de idempotencia", async () => {
    const { repositories, posApi } = createPosRepositories();

    const result = await new ProcessSaleReturnService(repositories).execute({
      ...returnContext,
      saleId: ids.sale,
      idempotencyKey: ids.request,
      reason: "Producto incorrecto",
      lines: [{ saleItemId: ids.saleItem, quantity: 1 }],
    });

    expect(posApi.processReturn).toHaveBeenCalledWith(ids.sale, ids.request, {
      reason: "Producto incorrecto",
      lines: [{ saleItemId: ids.saleItem, quantity: 1, trackingSelections: [] }],
    });
    expect(result).toEqual(mapApiReturnResult(ids.sale, apiReversalEffect));
  });

  it("VoidSale anula en el backend con la clave de idempotencia", async () => {
    const { repositories, posApi } = createPosRepositories();

    const result = await new VoidSaleService(repositories).execute({
      ...returnContext,
      saleId: ids.sale,
      idempotencyKey: ids.request,
      reason: "Venta duplicada",
    });

    expect(posApi.voidSale).toHaveBeenCalledWith(ids.sale, ids.request, { reason: "Venta duplicada" });
    expect(result).toEqual(mapApiVoidResult(apiVoidResult));
  });

  it("las mutaciones exigen permiso y la capacidad POS del plan", async () => {
    const noPermission = createPosRepositories({ role: { permissions: ["pos.returns.read"] } });
    await expect(
      new VoidSaleService(noPermission.repositories).execute({
        ...returnContext,
        saleId: ids.sale,
        idempotencyKey: ids.request,
        reason: "x",
      }),
    ).rejects.toThrow("No dispone de permisos para realizar esta operación.");

    const noPos = createPosRepositories({ planCapabilities: [] });
    await expect(
      new ProcessSaleReturnService(noPos.repositories).execute({
        ...returnContext,
        saleId: ids.sale,
        idempotencyKey: ids.request,
        reason: "x",
        lines: [],
      }),
    ).rejects.toThrow();
    expect(noPos.posApi.processReturn).not.toHaveBeenCalled();
  });

  it("los mappers conservan los efectos confirmados por el backend", () => {
    expect(mapApiReturnResult(ids.sale, apiReversalEffect)).toEqual({
      saleId: ids.sale,
      saleStatus: SaleStatus.partially_returned,
      operationType: "return",
      operationId: ids.operation,
      amount: 48.76,
      inventoryMovementIds: [ids.inventoryMovement],
      cashMovementIds: [ids.movement],
      inventoryRestored: true,
      cashMovementRecorded: true,
      cashMovementAmount: 48.76,
      idempotent: false,
    });
    expect(mapApiVoidResult(apiVoidResult)).toMatchObject({
      saleId: ids.sale,
      documentNumber: "V-100",
      saleStatus: SaleStatus.cancelled,
      operationType: "void",
      amount: 98.76,
      cashMovementRecorded: false,
      cashMovementAmount: undefined,
      idempotent: true,
    });
  });
});

describe("ConfirmSaleService: beforeSend", () => {
  it("se invoca justo antes del POST y, si lanza, la venta no se envía", async () => {
    const { repositories, posApi } = createPosRepositories();
    const beforeSend = vi.fn();

    await new ConfirmSaleService(repositories).execute(confirmInput({ beforeSend }));

    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(beforeSend.mock.invocationCallOrder[0]).toBeLessThan(
      posApi.confirmSale.mock.invocationCallOrder[0] ?? 0,
    );

    const blocked = createPosRepositories();
    await expect(
      new ConfirmSaleService(blocked.repositories).execute(
        confirmInput({
          beforeSend: () => {
            throw new Error("sin almacenamiento");
          },
        }),
      ),
    ).rejects.toThrow("sin almacenamiento");
    expect(blocked.posApi.confirmSale).not.toHaveBeenCalled();
  });

  it("no se invoca si una validación local falla antes del envío", async () => {
    const { repositories, posApi } = createPosRepositories({ role: { permissions: [] } });
    const beforeSend = vi.fn();

    await expect(
      new ConfirmSaleService(repositories).execute(confirmInput({ beforeSend })),
    ).rejects.toBeTruthy();
    expect(beforeSend).not.toHaveBeenCalled();
    expect(posApi.confirmSale).not.toHaveBeenCalled();
  });
});
