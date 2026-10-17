import { describe, expect, it, vi } from "vitest";
import {
  BranchStatus,
  DeliveryMethod,
  DispatchStatus,
  InventoryTransferStatus,
  OrderStatus,
  RoleStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { LogisticsHistoryReadRepository } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ApiLogisticsHistoryRepository } from "@/infrastructure/api/repositories/ApiLogisticsHistoryRepository";
import { withApiLogisticsHistory } from "@/infrastructure/api/withApiLogisticsHistory";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  TRANSFER_HISTORY_PREFIX,
  toLogisticsHistoryDetailDto,
  toLogisticsHistoryItemDto,
  toLogisticsHistoryStatusQuery,
} from "@/modules/logistics/application/mappers/LogisticsHistoryApiMapper";
import { GetLogisticsHistoryService } from "@/modules/logistics/application/services/GetLogisticsHistoryService";

const id = (suffix: number) => `20000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = {
  tenant: id(1),
  branch: id(2),
  user: id(3),
  role: id(4),
  order: id(5),
  picking: id(6),
  packing: id(7),
  dispatch: id(8),
  transfer: id(9),
  product: id(10),
  location: id(11),
  lot: id(12),
  package: id(13),
  session: id(14),
};
const at = "2026-10-09T15:00:00.000Z";

const orderRowJson = {
  sourceType: "order",
  sourceId: ids.order,
  orderId: ids.order,
  orderReference: "WEB-100",
  deliveryMethod: "home_delivery",
  operationalStatus: "dispatched",
  contactName: "Ana López",
  contactPhone: "55550101",
  pickingOrderId: ids.picking,
  packingId: ids.packing,
  dispatchId: ids.dispatch,
  storePickupDeliveryId: null,
  pickingCompletedAt: at,
  packingFinalizedAt: at,
  dispatchedAt: at,
  deliveredAt: null,
  responsibleUserId: ids.user,
  responsibleUserName: "Bodeguero",
  totalWeight: 2.5,
  packageCount: 1,
  dispatchStatus: "dispatched",
  carrierName: "Cargo Expreso",
  trackingNumber: "TRK-1",
};

const transferRowJson = {
  ...orderRowJson,
  sourceType: "transfer",
  sourceId: ids.transfer,
  orderId: null,
  orderReference: "TR-7",
  deliveryMethod: "transfer",
  operationalStatus: "inTransit",
  contactName: null,
  contactPhone: null,
  dispatchId: null,
  totalWeight: null,
  packageCount: null,
  dispatchStatus: null,
  carrierName: null,
  trackingNumber: null,
};

const pageJson = { items: [orderRowJson, transferRowJson], page: 1, pageSize: 20, totalItems: 2, totalPages: 1 };

const detailJson = {
  summary: orderRowJson,
  lines: [
    {
      productId: ids.product,
      productName: "Cable THHN",
      requestedQuantity: 3,
      pickedQuantity: 3,
      packedQuantity: 3,
      dispatchedQuantity: 3,
      trackingSelections: [
        {
          locationId: ids.location,
          lotId: ids.lot,
          lotNumber: "L-01",
          expirationDate: "2027-01-31",
          quantity: 1,
          serialNumbers: [],
        },
        {
          locationId: ids.location,
          lotId: null,
          lotNumber: null,
          expirationDate: null,
          quantity: 2,
          serialNumbers: ["S-1", "S-2"],
        },
      ],
    },
  ],
  packages: [{ id: ids.package, number: "PKG-1", weight: 2.5, description: null }],
};

function stubFetch(handler: (url: string) => Response) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return handler(String(input));
    }),
  );
  return urls;
}

describe("ApiLogisticsHistoryRepository", () => {
  it("consulta el historial con filtros, página desde 0 y tamaño acotado", async () => {
    const urls = stubFetch(() => Response.json(pageJson));
    const repository = new ApiLogisticsHistoryRepository();

    const result = await repository.search({
      branchId: ids.branch,
      search: "  WEB-100 ",
      status: OrderStatus.dispatched,
      deliveryMethod: "home_delivery",
      from: "2026-10-01",
      to: "2026-10-09",
      page: 3,
      pageSize: 500,
    });
    await repository.search({ branchId: ids.branch, search: "   ", page: 0, pageSize: 10 });

    expect(result.totalItems).toBe(2);
    expect(result.items[1]?.orderId).toBeNull();
    expect(urls).toEqual([
      `/api/backend/logistics/history?branchId=${ids.branch}&search=WEB-100&status=dispatched&deliveryMethod=home_delivery&from=2026-10-01&to=2026-10-09&page=2&size=100`,
      `/api/backend/logistics/history?branchId=${ids.branch}&page=0&size=10`,
    ]);
  });

  it("envía el estado equivalente de traslados junto al de pedidos", async () => {
    const urls = stubFetch(() => Response.json(pageJson));
    await new ApiLogisticsHistoryRepository().search({
      branchId: ids.branch,
      status: OrderStatus.dispatched,
      transferStatus: InventoryTransferStatus.inTransit,
      page: 1,
      pageSize: 10,
    });
    expect(urls[0]).toBe(
      `/api/backend/logistics/history?branchId=${ids.branch}&status=dispatched&transferStatus=inTransit&page=0&size=10`,
    );
  });

  it("valida sucursal y rango de fechas antes de llamar al backend", async () => {
    const urls = stubFetch(() => Response.json(pageJson));
    const repository = new ApiLogisticsHistoryRepository();

    await expect(repository.search({ branchId: "branch-1", page: 1, pageSize: 10 })).rejects.toThrow();
    await expect(
      repository.search({ branchId: ids.branch, from: "2026-10-09", to: "2026-10-01", page: 1, pageSize: 10 }),
    ).rejects.toThrow("La fecha inicial no puede ser posterior a la fecha final.");
    await expect(repository.getDetail(ids.branch, "order", "order-1")).rejects.toThrow();
    expect(urls).toHaveLength(0);
  });

  it("obtiene el detalle por tipo e id de origen", async () => {
    const urls = stubFetch(() => Response.json(detailJson));
    const detail = await new ApiLogisticsHistoryRepository().getDetail(ids.branch, "order", ids.order);

    expect(urls).toEqual([`/api/backend/logistics/history/order/${ids.order}?branchId=${ids.branch}`]);
    expect(detail.lines[0]?.trackingSelections[1]?.serialNumbers).toEqual(["S-1", "S-2"]);
    expect(detail.packages[0]?.description).toBeNull();
  });

  it("acepta paquetes y series ausentes", async () => {
    stubFetch(() =>
      Response.json({
        ...detailJson,
        packages: null,
        lines: [
          {
            ...detailJson.lines[0],
            trackingSelections: [{ ...detailJson.lines[0]!.trackingSelections[0], serialNumbers: null }],
          },
        ],
      }),
    );
    const detail = await new ApiLogisticsHistoryRepository().getDetail(ids.branch, "order", ids.order);
    expect(detail.packages).toEqual([]);
    expect(detail.lines[0]?.trackingSelections[0]?.serialNumbers).toEqual([]);
  });

  it("distingue cantidades nulas, cero y positivas sin convertir null en 0", async () => {
    const line = detailJson.lines[0]!;
    stubFetch(() =>
      Response.json({
        ...detailJson,
        lines: [
          { ...line, packedQuantity: null, dispatchedQuantity: null },
          { ...line, packedQuantity: 0, dispatchedQuantity: 0 },
          { ...line, packedQuantity: 3, dispatchedQuantity: 2 },
        ],
      }),
    );
    const detail = await new ApiLogisticsHistoryRepository().getDetail(ids.branch, "order", ids.order);

    expect(detail.lines.map(({ packedQuantity, dispatchedQuantity }) => [packedQuantity, dispatchedQuantity])).toEqual([
      [null, null],
      [0, 0],
      [3, 2],
    ]);
    expect(
      toLogisticsHistoryDetailDto(detail).items.map(({ packedQuantity, dispatchedQuantity }) => [
        packedQuantity,
        dispatchedQuantity,
      ]),
    ).toEqual([
      [null, null],
      [0, 0],
      [3, 2],
    ]);
  });

  it("rechaza cantidades en texto en lugar de convertirlas", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetch(() =>
      Response.json({ ...detailJson, lines: [{ ...detailJson.lines[0], requestedQuantity: "" }] }),
    );
    await expect(
      new ApiLogisticsHistoryRepository().getDetail(ids.branch, "order", ids.order),
    ).rejects.toMatchObject({ status: 502, fields: { "lines.0.requestedQuantity": expect.any(String) } });
  });

  it("rechaza respuestas inválidas indicando el campo, sin exponer valores", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetch(() => Response.json({ ...pageJson, items: [{ ...orderRowJson, deliveryMethod: "drone" }] }));

    await expect(
      new ApiLogisticsHistoryRepository().search({ branchId: ids.branch, page: 1, pageSize: 10 }),
    ).rejects.toMatchObject({
      status: 502,
      code: "INVALID_BACKEND_RESPONSE",
      fields: { "items.0.deliveryMethod": expect.any(String) },
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("Ana López");
  });

  it.each([400, 403, 404, 500])("preserva el error %s del backend", async (status) => {
    stubFetch(() => Response.json({ message: `HTTP ${status}`, code: `LOG_${status}` }, { status }));
    await expect(
      new ApiLogisticsHistoryRepository().search({ branchId: ids.branch, page: 1, pageSize: 10 }),
    ).rejects.toMatchObject({ status, code: `LOG_${status}`, message: `HTTP ${status}` });
  });

  it("withApiLogisticsHistory decora el registro sin mutarlo", () => {
    const original = { logisticsHistoryDataSource: "mock" } as unknown as RepositoryRegistry;
    const decorated = withApiLogisticsHistory(original);
    expect(decorated.logisticsHistoryDataSource).toBe("api");
    expect(decorated.logisticsHistory).toBeInstanceOf(ApiLogisticsHistoryRepository);
    expect(original.logisticsHistoryDataSource).toBe("mock");
  });
});

describe("LogisticsHistoryApiMapper", () => {
  it("traduce pedidos y traslados a la fila de pantalla", async () => {
    stubFetch(() => Response.json(pageJson));
    const page = await new ApiLogisticsHistoryRepository().search({
      branchId: ids.branch,
      page: 1,
      pageSize: 10,
    });
    const [order, transfer] = page.items.map(toLogisticsHistoryItemDto);

    expect(order).toMatchObject({
      orderId: ids.order,
      orderReference: "WEB-100",
      deliveryMethod: DeliveryMethod.home_delivery,
      operationalStatus: OrderStatus.dispatched,
      dispatchStatus: DispatchStatus.dispatched,
      contactName: "Ana López",
    });
    expect(transfer).toMatchObject({
      orderId: `${TRANSFER_HISTORY_PREFIX}${ids.transfer}`,
      orderReference: "Traslado TR-7",
      deliveryMethod: "transfer",
      operationalStatus: OrderStatus.dispatched,
      contactName: "Sucursal destino",
    });
  });

  it.each([
    ["received", OrderStatus.delivered],
    ["preparing", OrderStatus.preparing],
    ["cancelled", OrderStatus.cancelled],
  ])("presenta el traslado %s como %s", (status, expected) => {
    const row = toLogisticsHistoryItemDto({ ...toRowModel(transferRowJson), operationalStatus: status });
    expect(row.operationalStatus).toBe(expected);
  });

  it.each([
    ["all", {}],
    [OrderStatus.dispatched, { status: OrderStatus.dispatched, transferStatus: InventoryTransferStatus.inTransit }],
    [OrderStatus.delivered, { status: OrderStatus.delivered, transferStatus: InventoryTransferStatus.received }],
    [OrderStatus.cancelled, { status: OrderStatus.cancelled, transferStatus: InventoryTransferStatus.cancelled }],
    [OrderStatus.packing, { status: OrderStatus.packing, transferStatus: undefined }],
    [OrderStatus.ready_for_pickup, { status: OrderStatus.ready_for_pickup, transferStatus: undefined }],
  ] as const)("el filtro %s incluye el estado equivalente de traslados", (status, expected) => {
    expect(toLogisticsHistoryStatusQuery(status)).toEqual(expected);
  });

  it("rechaza estados operativos desconocidos", () => {
    expect(() =>
      toLogisticsHistoryItemDto({ ...toRowModel(orderRowJson), operationalStatus: "lost" }),
    ).toThrow("Estado operativo no reconocido en el historial: lost");
  });

  it("expande las series y conserva lote, vencimiento y cantidades derivadas", async () => {
    stubFetch(() => Response.json(detailJson));
    const detail = toLogisticsHistoryDetailDto(
      await new ApiLogisticsHistoryRepository().getDetail(ids.branch, "order", ids.order),
    );
    const [line] = detail.items;

    expect(line).toMatchObject({
      name: "Cable THHN",
      sku: "",
      requestedQuantity: 3,
      packedQuantity: 3,
      dispatchedQuantity: 3,
    });
    expect(line?.allocations).toEqual([
      expect.objectContaining({
        quantity: 1,
        lot: { id: ids.lot, number: "L-01", expiresAt: "2027-01-31" },
        serial: null,
        location: { id: ids.location, code: "", name: "" },
      }),
      expect.objectContaining({ quantity: 1, lot: null, serial: { id: "S-1", number: "S-1" } }),
      expect.objectContaining({ quantity: 1, serial: { id: "S-2", number: "S-2" } }),
    ]);
  });
});

describe("GetLogisticsHistoryService en modo API", () => {
  function createService(overrides: { permissions?: string[]; api?: Partial<LogisticsHistoryReadRepository> | null } = {}) {
    const api = {
      search: vi.fn().mockResolvedValue({
        items: [toRowModel(orderRowJson)],
        page: 2,
        pageSize: 10,
        totalItems: 11,
        totalPages: 2,
      }),
      getDetail: vi.fn().mockResolvedValue({ summary: toRowModel(orderRowJson), lines: [], packages: [] }),
      ...overrides.api,
    };
    const repositories = {
      logisticsHistoryDataSource: "api",
      logisticsHistory: overrides.api === null ? undefined : api,
      auth: {
        getCurrentSessionId: vi.fn().mockResolvedValue(ids.session),
        getSession: vi.fn().mockResolvedValue({
          id: ids.session,
          userId: ids.user,
          expiresAt: "2999-01-01T00:00:00.000Z",
          revokedAt: null,
        }),
      },
      users: {
        getById: vi.fn().mockResolvedValue({
          id: ids.user,
          tenantId: ids.tenant,
          status: UserStatus.active,
          type: UserType.employee,
          roleId: ids.role,
          allowedBranchIds: [ids.branch],
        }),
      },
      roles: {
        getByIdScoped: vi.fn().mockResolvedValue({
          id: ids.role,
          tenantId: ids.tenant,
          status: RoleStatus.active,
          branchScope: "assigned",
          permissions: overrides.permissions ?? ["logistics.history.read"],
        }),
      },
      branches: {
        getById: vi.fn().mockResolvedValue({ id: ids.branch, tenantId: ids.tenant, status: BranchStatus.active }),
      },
    } as unknown as RepositoryRegistry;
    return { service: new GetLogisticsHistoryService(repositories), api };
  }

  it("busca en el backend traduciendo los filtros de pantalla", async () => {
    const { service, api } = createService();

    const page = await service.searchApi(ids.branch, {
      search: "web",
      status: "all",
      deliveryMethod: DeliveryMethod.store_pickup,
      from: "2026-10-01",
      to: "",
      page: 2,
      pageSize: 10,
    });

    expect(service.usesApi).toBe(true);
    expect(api.search).toHaveBeenCalledWith({
      branchId: ids.branch,
      search: "web",
      status: undefined,
      deliveryMethod: DeliveryMethod.store_pickup,
      from: "2026-10-01",
      to: "",
      page: 2,
      pageSize: 10,
    });
    expect(page).toMatchObject({ page: 2, totalItems: 11, totalPages: 2 });
    expect(page.items[0]?.orderReference).toBe("WEB-100");
  });

  it("filtrar por Despachado pide pedidos despachados y traslados en tránsito con los totales del servidor", async () => {
    const { service, api } = createService({
      api: {
        search: vi.fn().mockResolvedValue({
          items: [toRowModel(orderRowJson), toRowModel(transferRowJson)],
          page: 1,
          pageSize: 10,
          totalItems: 12,
          totalPages: 2,
        }),
      },
    });

    const page = await service.searchApi(ids.branch, {
      search: "",
      status: OrderStatus.dispatched,
      deliveryMethod: "all",
      from: "",
      to: "",
      page: 1,
      pageSize: 10,
    });

    expect(api.search).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OrderStatus.dispatched,
        transferStatus: InventoryTransferStatus.inTransit,
        deliveryMethod: undefined,
      }),
    );
    expect(page.items.map((item) => [item.sourceType, item.operationalStatus])).toEqual([
      ["order", OrderStatus.dispatched],
      ["transfer", OrderStatus.dispatched],
    ]);
    expect(page).toMatchObject({ totalItems: 12, totalPages: 2 });
  });

  it("pide el detalle por tipo e id de origen", async () => {
    const { service, api } = createService();
    const detail = await service.getApiDetail(ids.branch, { sourceType: "order", sourceId: ids.order });
    expect(api.getDetail).toHaveBeenCalledWith(ids.branch, "order", ids.order);
    expect(detail.summary.orderId).toBe(ids.order);
  });

  it("exige permiso de historial y el repositorio API configurado", async () => {
    const withoutPermission = createService({ permissions: ["logistics.picking.read"] });
    await expect(
      withoutPermission.service.searchApi(ids.branch, {
        search: "",
        status: "all",
        deliveryMethod: "all",
        from: "",
        to: "",
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toThrow();
    expect(withoutPermission.api.search).not.toHaveBeenCalled();

    const withoutApi = createService({ api: null });
    await expect(
      withoutApi.service.getApiDetail(ids.branch, { sourceType: "order", sourceId: ids.order }),
    ).rejects.toThrow("La integración API del historial logístico no está disponible.");
  });

  it("propaga los errores del backend", async () => {
    const { service } = createService({
      api: { search: vi.fn().mockRejectedValue(new BackendRequestError("Sin capacidad de inventario", 403)) },
    });
    await expect(
      service.searchApi(ids.branch, {
        search: "",
        status: OrderStatus.cancelled,
        deliveryMethod: "all",
        from: "",
        to: "",
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toThrow("Sin capacidad de inventario");
  });
});

/** Fixture JSON → read model ya parseado (mismos campos; los nulos ya son `null`). */
function toRowModel(row: object) {
  return row as Parameters<typeof toLogisticsHistoryItemDto>[0];
}
