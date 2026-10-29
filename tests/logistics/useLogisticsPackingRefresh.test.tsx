import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryMethod, PackingStatus } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { PackingDetailDto, PackingQueueItemDto } from "@/modules/logistics/application/dto/PackingReadModelDto";
import { PackingMutationCoordinator } from "@/modules/logistics/hooks/packingRequestIdentity";
import { useLogisticsPacking } from "@/modules/logistics/hooks/useLogisticsPacking";
import type { PackingPreparationValidationResult } from "@/modules/logistics/validation/packing.validation";
import { deferred } from "./dispatchFixtures";

const ids = {
  tenant: "70000000-0000-4000-8000-000000000001",
  branch: "70000000-0000-4000-8000-000000000002",
  packing: "70000000-0000-4000-8000-000000000003",
  order: "70000000-0000-4000-8000-000000000004",
  user: "70000000-0000-4000-8000-000000000005",
};

const mocks = vi.hoisted(() => ({
  repositories: { packingDataSource: "api" } as object,
  eventBus: null as unknown as DataEventBus,
  coordinator: null as unknown as PackingMutationCoordinator,
  branch: {} as { currentBranch: { id: string; tenantId: string; name: string } | null; loading: boolean },
  session: {} as {
    user: { id: string; tenantId: string } | null;
    canAccessBranch: ReturnType<typeof vi.fn>;
    hasPermission: ReturnType<typeof vi.fn>;
    loading: boolean;
    error: string | null;
  },
  service: {
    getQueue: vi.fn(),
    getDetail: vi.fn(),
    savePreparation: vi.fn(),
    generateLabel: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
  useDataEventBus: () => mocks.eventBus,
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({ useCurrentSession: () => mocks.session }));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({ useActiveBranch: () => mocks.branch }));
vi.mock("@/modules/logistics/providers/PackingMutationCoordinatorProvider", () => ({
  usePackingMutationCoordinator: () => mocks.coordinator,
}));
vi.mock("@/modules/logistics/application/services/PackingApplicationService", () => ({
  PackingApplicationService: class {
    getQueue(branchId: string) {
      return mocks.service.getQueue(branchId);
    }

    getDetail(branchId: string, packingId: string) {
      return mocks.service.getDetail(branchId, packingId);
    }

    savePreparation(branchId: string, command: unknown) {
      return mocks.service.savePreparation(branchId, command);
    }

    generateLabel(branchId: string, command: unknown) {
      return mocks.service.generateLabel(branchId, command);
    }
  },
}));

function packing(overrides: Partial<PackingDetailDto> = {}): PackingDetailDto {
  return {
    packingId: ids.packing,
    orderId: ids.order,
    orderReference: "ORD-800",
    customerName: "Cliente",
    storePickupContact: null,
    deliveryMethod: DeliveryMethod.home_delivery,
    status: PackingStatus.in_progress,
    version: 1,
    startedAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
    pickingOrderId: "70000000-0000-4000-8000-000000000006",
    orderStatus: null,
    deliveryAddress: null,
    checklist: { packageProtectionChecked: false, documentIncludedChecked: false, recipientVerifiedChecked: false },
    totalWeight: null,
    packageCount: null,
    labelGenerationId: null,
    labelCode: null,
    labelGeneratedAt: null,
    labelPrintedAt: null,
    finalizedAt: null,
    preparedContents: [],
    ...overrides,
  };
}

const queueItem = (detail: PackingDetailDto): PackingQueueItemDto => ({
  packingId: detail.packingId,
  orderId: detail.orderId,
  orderReference: detail.orderReference,
  customerName: detail.customerName,
  storePickupContact: null,
  deliveryMethod: detail.deliveryMethod,
  status: detail.status,
  version: detail.version,
  startedAt: detail.startedAt,
  updatedAt: detail.updatedAt,
});

const v1 = packing();
const v2 = packing({
  version: 2,
  checklist: { packageProtectionChecked: true, documentIncludedChecked: true, recipientVerifiedChecked: true },
  totalWeight: 2,
  packageCount: 1,
});
const v3 = packing({ ...v2, version: 3 });
const validation = {
  valid: true,
  errors: {},
  values: { checklist: v2.checklist, totalWeight: 2, packageCount: 1 },
} as unknown as PackingPreparationValidationResult;

async function selectedHook(first: PackingDetailDto = v1) {
  mocks.service.getDetail.mockResolvedValue(first);
  const loadings: boolean[] = [];
  const detailLoadings: boolean[] = [];
  const view = renderHook(() => {
    const hook = useLogisticsPacking();
    loadings.push(hook.loading);
    detailLoadings.push(hook.detailLoading);
    return hook;
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => {
    await view.result.current.selectPacking(ids.packing);
  });
  expect(view.result.current.detail).toEqual(first);
  loadings.length = 0;
  detailLoadings.length = 0;
  return { view, loadings, detailLoadings };
}

describe("Packing: actualizaciones sin reconstruir la mesa", () => {
  beforeEach(() => {
    mocks.eventBus = new DataEventBus();
    mocks.coordinator = new PackingMutationCoordinator();
    mocks.branch = { currentBranch: { id: ids.branch, tenantId: ids.tenant, name: "Central" }, loading: false };
    mocks.session = {
      user: { id: ids.user, tenantId: ids.tenant },
      canAccessBranch: vi.fn(() => true),
      hasPermission: vi.fn(() => true),
      loading: false,
      error: null,
    };
    mocks.service.getQueue.mockReset().mockResolvedValue([queueItem(v1)]);
    mocks.service.getDetail.mockReset().mockResolvedValue(v1);
    mocks.service.savePreparation.mockReset().mockResolvedValue({ packing: v2, idempotent: false });
    mocks.service.generateLabel.mockReset();
  });

  it("guardar la preparacion aplica la version nueva sin volver a mostrar la carga global", async () => {
    const { view, loadings, detailLoadings } = await selectedHook();

    await act(async () => {
      await expect(view.result.current.savePreparation(validation)).resolves.toBe(true);
    });

    expect(mocks.service.savePreparation).toHaveBeenCalledWith(
      ids.branch,
      expect.objectContaining({ packingId: ids.packing, expectedVersion: 1, operationId: expect.any(String) }),
    );
    expect(view.result.current.detail).toEqual(v2);
    expect(view.result.current.selectedPackingId).toBe(ids.packing);
    expect(view.result.current.submitting).toBe(false);
    expect(mocks.service.getQueue).toHaveBeenCalledTimes(2);
    expect(loadings.length).toBeGreaterThan(0);
    expect(loadings.every((value) => value === false)).toBe(true);
    expect(detailLoadings.every((value) => value === false)).toBe(true);
  });

  it("generar la etiqueta usa el detalle devuelto por el backend y tampoco oculta la mesa", async () => {
    const labelled = packing({ ...v2, version: 3, labelGenerationId: "label-1", labelCode: "LBL-1", labelGeneratedAt: "2026-10-20T11:00:00Z" });
    mocks.service.generateLabel.mockResolvedValue({ packing: labelled, idempotent: false });
    const { view, loadings } = await selectedHook(v2);

    await act(async () => {
      await expect(view.result.current.generateLabel()).resolves.toBe(true);
    });

    expect(mocks.service.generateLabel).toHaveBeenCalledWith(
      ids.branch,
      expect.objectContaining({ expectedVersion: 2 }),
    );
    expect(view.result.current.detail).toEqual(labelled);
    expect(loadings.every((value) => value === false)).toBe(true);
  });

  it("si el backend rechaza la operacion conserva el detalle anterior y muestra el mensaje", async () => {
    mocks.service.savePreparation.mockRejectedValueOnce(new Error("No se pudo guardar."));
    const { view, loadings } = await selectedHook();

    await act(async () => {
      await expect(view.result.current.savePreparation(validation)).resolves.toBe(false);
    });

    expect(view.result.current.detail).toEqual(v1);
    expect(view.result.current.workspaceError).toBe("No se pudo guardar.");
    expect(view.result.current.submitting).toBe(false);
    expect(loadings.every((value) => value === false)).toBe(true);
  });

  it("rechaza una segunda operacion mientras la primera espera la respuesta del backend", async () => {
    const pending = deferred<{ packing: PackingDetailDto; idempotent: boolean }>();
    mocks.service.savePreparation.mockReturnValueOnce(pending.promise);
    const { view } = await selectedHook();

    let first!: Promise<boolean>;
    act(() => {
      first = view.result.current.savePreparation(validation);
    });
    await waitFor(() => expect(view.result.current.submitting).toBe(true));

    await act(async () => {
      await expect(view.result.current.savePreparation(validation)).resolves.toBe(false);
    });
    expect(mocks.service.savePreparation).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve({ packing: v2, idempotent: false });
      await first;
    });
    expect(view.result.current.detail).toEqual(v2);
    expect(view.result.current.submitting).toBe(false);
  });

  it("publica packing.changed con origen propio para Despacho y no se recarga a si mismo", async () => {
    const { view } = await selectedHook();
    const heard = vi.fn();
    mocks.eventBus.subscribe("packing.changed", heard);

    await act(async () => {
      await view.result.current.savePreparation(validation);
    });

    expect(heard).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: ids.tenant,
      branchId: ids.branch,
      packingId: ids.packing,
      metadata: { origin: expect.any(String) },
    }));
    // Solo la lectura inicial del detalle: el aviso propio no provoca otra.
    expect(mocks.service.getDetail).toHaveBeenCalledTimes(1);
  });

  it("un cambio ajeno con una version mas nueva se aplica en silencio", async () => {
    const { view, loadings, detailLoadings } = await selectedHook();
    mocks.service.getDetail.mockResolvedValueOnce(v3);

    act(() => {
      mocks.eventBus.emit("packing.changed", { tenantId: ids.tenant, branchId: ids.branch, packingId: ids.packing });
    });

    await waitFor(() => expect(view.result.current.detail).toEqual(v3));
    expect(loadings.every((value) => value === false)).toBe(true);
    expect(detailLoadings.every((value) => value === false)).toBe(true);
  });

  it("una lectura con una version anterior a la mostrada nunca la reemplaza", async () => {
    const { view } = await selectedHook(v2);
    mocks.service.getDetail.mockResolvedValueOnce(v1);

    act(() => {
      mocks.eventBus.emit("packing.changed", { tenantId: ids.tenant, branchId: ids.branch, packingId: ids.packing });
    });
    await waitFor(() => expect(mocks.service.getDetail).toHaveBeenCalledTimes(2));

    expect(view.result.current.detail).toEqual(v2);
  });

  it("ignora eventos de otra sucursal", async () => {
    await selectedHook();
    mocks.service.getQueue.mockClear();

    act(() => {
      mocks.eventBus.emit("packing.changed", {
        tenantId: ids.tenant,
        branchId: "99999999-0000-4000-8000-000000000000",
        packingId: ids.packing,
      });
    });

    expect(mocks.service.getQueue).not.toHaveBeenCalled();
  });
});
