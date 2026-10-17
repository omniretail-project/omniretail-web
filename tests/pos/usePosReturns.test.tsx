import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentMethod, PaymentStatus, SaleStatus } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { ReturnSaleLookupDto } from "@/modules/pos/application/dto/ReturnSaleLookupDto";
import { usePosReturns } from "@/modules/pos/hooks/usePosReturns";
import { ids } from "./posFixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  branch: {} as {
    currentBranch: { id: string; tenantId: string; name: string } | null;
    loading: boolean;
  },
  session: {} as {
    sessionId: string | null;
    user: { id: string; tenantId: string } | null;
    canAccessBranch: (branchId: string) => boolean;
    hasPermission: (permission: string) => boolean;
    loading: boolean;
    error: string | null;
  },
  lookup: vi.fn(),
  processReturn: vi.fn(),
  voidSale: vi.fn(),
}));

const stableRepositories = vi.hoisted(() => ({}));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => stableRepositories,
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => mocks.session,
}));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => mocks.branch,
}));
vi.mock("@/shared/hooks/useEntitlement", () => ({
  useEntitlement: () => ({ hasCapability: () => true }),
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));
vi.mock("@/modules/pos/application/services/GetReturnSaleLookupService", () => ({
  GetReturnSaleLookupService: class {
    execute(input: unknown) {
      return mocks.lookup(input);
    }
  },
}));
vi.mock("@/modules/pos/application/services/ProcessSaleReturnService", () => ({
  ProcessSaleReturnService: class {
    execute(input: unknown) {
      return mocks.processReturn(input);
    }
  },
}));
vi.mock("@/modules/pos/application/services/VoidSaleService", () => ({
  VoidSaleService: class {
    execute(input: unknown) {
      return mocks.voidSale(input);
    }
  },
}));

const lookup: ReturnSaleLookupDto = {
  sale: {
    saleId: ids.sale,
    documentNumber: "V-100",
    date: "2026-10-09T12:00:00.000Z",
    customerDisplayName: "Consumidor final",
    total: 100,
    status: SaleStatus.completed,
  },
  items: [
    {
      saleItemId: ids.saleItem,
      productId: ids.product,
      sku: "POS-001",
      name: "Producto POS",
      soldQuantity: 2,
      returnedQuantity: 0,
      returnableQuantity: 2,
      unitPrice: 50,
      discount: 0,
      subtotal: 100,
      canReturn: true,
    },
  ],
  payments: [
    { paymentId: ids.paymentCash, method: PaymentMethod.cash, amount: 100, status: PaymentStatus.approved },
  ],
  returnableItems: [],
  paymentSummary: "cash",
  isWithinCurrentShift: true,
  allowedOperations: { voidTotal: true, partialReturn: true },
} as ReturnSaleLookupDto;

const reversal = {
  saleId: ids.sale,
  saleStatus: SaleStatus.cancelled,
  operationType: "void",
  operationId: ids.operation,
  amount: 100,
  inventoryMovementIds: [],
  cashMovementIds: [],
  inventoryRestored: true,
  cashMovementRecorded: true,
  idempotent: false,
};

/** El hook reinicia su estado en un microtask al montar o cambiar de contexto. */
async function flushContextReset() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderReturns() {
  const view = renderHook(() => usePosReturns());
  await flushContextReset();
  return view;
}

async function renderWithLookup() {
  const view = await renderReturns();
  act(() => view.result.current.setDocumentNumber(" V-100 "));
  await act(async () => {
    await view.result.current.search();
  });
  await waitFor(() => expect(view.result.current.lookup?.sale.saleId).toBe(ids.sale));
  return view;
}

describe("usePosReturns", () => {
  beforeEach(() => {
    mocks.branch = {
      currentBranch: { id: ids.branch, tenantId: ids.tenant, name: "Centro" },
      loading: false,
    };
    mocks.session = {
      sessionId: ids.session,
      user: { id: ids.user, tenantId: ids.tenant },
      canAccessBranch: () => true,
      hasPermission: () => true,
      loading: false,
      error: null,
    };
    mocks.lookup.mockResolvedValue(lookup);
    mocks.voidSale.mockResolvedValue(reversal);
    mocks.processReturn.mockResolvedValue({ ...reversal, operationType: "return" });
  });

  it("busca la venta con el documento normalizado y el contexto activo", async () => {
    await renderWithLookup();
    expect(mocks.lookup).toHaveBeenCalledWith({
      tenantId: ids.tenant,
      branchId: ids.branch,
      actorUserId: ids.user,
      documentNumber: "V-100",
    });
  });

  it("informa venta inexistente, documento vacío y errores del backend", async () => {
    const { result } = await renderReturns();
    await act(async () => {
      await result.current.search();
    });
    expect(result.current.lookupError).toBe("Ingrese el número de documento que desea consultar.");

    mocks.lookup.mockResolvedValueOnce(null);
    act(() => result.current.setDocumentNumber("V-999"));
    await act(async () => {
      await result.current.search();
    });
    expect(result.current.notFound).toBe(true);

    mocks.lookup.mockRejectedValueOnce(new BackendRequestError("x", 401));
    await act(async () => {
      await result.current.search();
    });
    expect(result.current.lookupError).toBe("Tu sesión expiró. Inicia sesión nuevamente para continuar.");
  });

  it("anula con una clave de idempotencia y la reutiliza al reintentar tras un fallo incierto", async () => {
    const { result } = await renderWithLookup();
    act(() => result.current.beginOperation("void"));
    act(() => result.current.setReason("Venta duplicada"));
    mocks.voidSale.mockRejectedValueOnce(new BackendRequestError("x", 0));

    await act(async () => {
      expect(await result.current.submitOperation()).toBe(false);
    });
    expect(result.current.operationError).toContain("no se duplicará");
    const firstKey = mocks.voidSale.mock.calls[0]?.[0].idempotencyKey;

    await act(async () => {
      expect(await result.current.submitOperation()).toBe(true);
    });
    expect(mocks.voidSale.mock.calls[1]?.[0]).toMatchObject({
      saleId: ids.sale,
      idempotencyKey: firstKey,
      reason: "Venta duplicada",
    });
    expect(result.current.result).toEqual(reversal);
    expect(mocks.lookup).toHaveBeenCalledTimes(3);
  });

  it("procesa una devolución parcial con las líneas seleccionadas", async () => {
    const { result } = await renderWithLookup();
    act(() => result.current.beginOperation("return"));
    act(() => result.current.setReason("Producto dañado"));
    act(() => result.current.setLineQuantity(ids.saleItem, "1"));

    await act(async () => {
      expect(await result.current.submitOperation()).toBe(true);
    });

    expect(mocks.processReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        saleId: ids.sale,
        reason: "Producto dañado",
        lines: [{ saleItemId: ids.saleItem, quantity: 1 }],
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("descarta el resultado de una anulación si cambió la sucursal en curso", async () => {
    const view = await renderWithLookup();
    act(() => view.result.current.beginOperation("void"));
    act(() => view.result.current.setReason("Venta duplicada"));
    const pending = deferred<typeof reversal>();
    mocks.voidSale.mockReturnValueOnce(pending.promise);

    let submission!: Promise<boolean>;
    act(() => {
      submission = view.result.current.submitOperation();
    });
    mocks.branch = {
      currentBranch: { id: ids.otherBranch, tenantId: ids.tenant, name: "Norte" },
      loading: false,
    };
    view.rerender();
    pending.resolve(reversal);
    await act(async () => {
      expect(await submission).toBe(false);
    });

    expect(view.result.current.result).toBeNull();
    await waitFor(() => expect(view.result.current.lookup).toBeNull());
  });

  it("descarta una búsqueda que responde después de cambiar de sucursal", async () => {
    const pending = deferred<ReturnSaleLookupDto>();
    mocks.lookup.mockReturnValueOnce(pending.promise);
    const view = await renderReturns();
    act(() => view.result.current.setDocumentNumber("V-100"));
    let searching!: Promise<boolean>;
    act(() => {
      searching = view.result.current.search();
    });
    mocks.branch = {
      currentBranch: { id: ids.otherBranch, tenantId: ids.tenant, name: "Norte" },
      loading: false,
    };
    view.rerender();
    pending.resolve(lookup);
    await act(async () => {
      expect(await searching).toBe(false);
    });
    expect(view.result.current.lookup).toBeNull();
  });
});
