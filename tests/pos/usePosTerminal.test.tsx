import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashShiftStatus, PaymentMethod, ProductType } from "@/core/enums";
import type { DataEventName } from "@/core/types/events.types";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";
import { usePosTerminal } from "@/modules/pos/hooks/usePosTerminal";
import { id, ids } from "./posFixtures";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({
  repositories: {} as object,
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
  listeners: new Map<string, Set<() => void>>(),
  products: vi.fn(),
  confirm: vi.fn(),
  openShift: vi.fn(),
  bankAccounts: vi.fn(),
  capabilities: vi.fn(),
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
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
vi.mock("@/shared/hooks/useDataEvent", async () => {
  const react = await import("react");
  return {
    useDataEvent: (event: string, listener: () => void) => {
      react.useEffect(() => {
        const set = mocks.listeners.get(event) ?? new Set<() => void>();
        set.add(listener);
        mocks.listeners.set(event, set);
        return () => {
          set.delete(listener);
        };
      }, [event, listener]);
    },
  };
});
vi.mock("@/modules/pos/application/services/GetPosProductsService", () => ({
  GetPosProductsService: class {
    execute(input: unknown) {
      return mocks.products(input);
    }
  },
}));
vi.mock("@/modules/pos/application/services/ConfirmSaleService", () => ({
  ConfirmSaleService: class {
    execute(input: { beforeSend?: () => void }) {
      // El servicio real invoca `beforeSend` justo antes del POST (modo API).
      const { beforeSend, ...request } = input;
      beforeSend?.();
      return mocks.confirm(request);
    }
  },
}));
vi.mock("@/modules/pos/application/services/GetOpenCashShiftService", () => ({
  GetOpenCashShiftService: class {
    execute(input: unknown) {
      return mocks.openShift(input);
    }
  },
}));
vi.mock("@/modules/pos/application/services/GetCheckoutBankAccountsService", () => ({
  GetCheckoutBankAccountsService: class {
    execute(input: unknown) {
      return mocks.bankAccounts(input);
    }
  },
}));

function emit(event: DataEventName) {
  mocks.listeners.get(event)?.forEach((listener) => listener());
}

const product: PosProductDto = {
  productId: ids.product,
  sku: "POS-001",
  name: "Producto POS",
  productType: ProductType.physical,
  basePrice: 50,
  effectivePrice: 50,
  discount: 0,
  salesPriceTiers: [],
  availableQuantity: 10,
  saleUnitId: id(50),
  saleUnitName: "Unidad",
  tracksStock: true,
  requiresLot: false,
  requiresSerial: false,
  requiresUnsupportedTraceability: false,
  isAvailableForSale: true,
};

const openShift = (branchId = ids.branch) => ({
  id: ids.shift,
  branchId,
  userId: ids.user,
  registerCode: "POS-01",
  status: CashShiftStatus.open,
  openedAt: "2026-10-09T12:00:00.000Z",
  openingAmount: 100,
});

const saleResult = {
  sale: { id: ids.sale, number: "V-100", total: 50 },
  payments: [{ currency: "GTQ" }],
  inventoryMovements: [{ id: ids.inventoryMovement }],
  idempotent: false,
};

async function renderReadyTerminal() {
  const view = renderHook(() => usePosTerminal());
  await waitFor(() => expect(view.result.current.hasOpenCashShift).toBe(true));
  await waitFor(() => expect(view.result.current.products).toHaveLength(1));
  await waitFor(() => expect(view.result.current.paymentMethodsLoading).toBe(false));
  return view;
}

async function prepareCashCheckout(result: { current: ReturnType<typeof usePosTerminal> }) {
  act(() => result.current.addProduct(product));
  act(() => result.current.openCheckout());
  act(() => result.current.updateCheckout({ cashReceived: 50 }));
  act(() => result.current.validateCheckout());
  await waitFor(() => expect(result.current.checkoutReadyToConfirm).toBe(true));
}

describe("usePosTerminal", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.listeners.clear();
    mocks.capabilities.mockResolvedValue({
      allowedPosPaymentMethods: [PaymentMethod.cash, PaymentMethod.card],
    });
    mocks.repositories = { businessConfig: { getCapabilities: mocks.capabilities } };
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
    mocks.products.mockResolvedValue([product]);
    mocks.openShift.mockImplementation(async ({ branchId }: { branchId: string }) => openShift(branchId));
    mocks.bankAccounts.mockResolvedValue([]);
    mocks.confirm.mockResolvedValue(saleResult);
  });

  it("carga catálogo, caja, cuentas y métodos de pago del contexto activo", async () => {
    const { result } = await renderReadyTerminal();

    expect(mocks.products).toHaveBeenCalledWith({ tenantId: ids.tenant, branchId: ids.branch });
    expect(mocks.openShift).toHaveBeenCalledWith({
      tenantId: ids.tenant,
      actorUserId: ids.user,
      branchId: ids.branch,
    });
    expect(result.current.cashShift?.id).toBe(ids.shift);
    expect(result.current.availablePaymentModes).toEqual(["cash", "card", "mixed"]);
    expect(result.current.currentBranchName).toBe("Centro");
  });

  it("confirma la venta una sola vez y limpia el ticket con el resultado del backend", async () => {
    const { result } = await renderReadyTerminal();
    await prepareCashCheckout(result);
    const pending = deferred<typeof saleResult>();
    mocks.confirm.mockReturnValueOnce(pending.promise);

    let first!: Promise<void>;
    act(() => {
      first = result.current.confirmSale();
      void result.current.confirmSale();
    });
    await waitFor(() => expect(result.current.confirmationLoading).toBe(true));
    pending.resolve(saleResult);
    await act(async () => first);

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm.mock.calls[0]?.[0]).toMatchObject({
      branchId: ids.branch,
      cashShiftId: ids.shift,
      confirmationId: expect.any(String),
    });
    expect(result.current.confirmationResult).toEqual(saleResult);
    expect(result.current.ticketItems).toEqual([]);
    expect(result.current.confirmationError).toBeNull();
  });

  describe("edicion directa de cantidad", () => {
    it("actualiza la cantidad y recalcula los importes confirmados", async () => {
      const { result } = await renderReadyTerminal();
      act(() => result.current.addProduct(product));

      act(() => result.current.setQuantity(product.productId, 3));

      expect(result.current.ticketItems[0]).toMatchObject({ quantity: 3, subtotal: 150 });
      expect(result.current.subtotal).toBe(150);
      expect(result.current.discountTotal).toBe(0);
      expect(result.current.total).toBe(150);
      expect(result.current.ticketError).toBeNull();
    });

    it("rechaza cantidades superiores a la existencia disponible", async () => {
      const { result } = await renderReadyTerminal();
      act(() => result.current.addProduct(product));

      act(() => result.current.setQuantity(product.productId, 11));

      expect(result.current.ticketItems[0]?.quantity).toBe(1);
      expect(result.current.total).toBe(50);
      expect(result.current.ticketError).toContain("No puedes agregar más de 10");
    });

    it.each([0, -1])("rechaza la cantidad no positiva %s", async (quantity) => {
      const { result } = await renderReadyTerminal();
      act(() => result.current.addProduct(product));

      act(() => result.current.setQuantity(product.productId, quantity));

      expect(result.current.ticketItems[0]?.quantity).toBe(1);
      expect(result.current.total).toBe(50);
      expect(result.current.ticketError).toBe(
        "La cantidad debe ser un número entero mayor que cero.",
      );
    });

    it("ignora un producto que no existe en el ticket", async () => {
      const { result } = await renderReadyTerminal();
      act(() => result.current.addProduct(product));

      act(() => result.current.setQuantity(id(999), 4));

      expect(result.current.ticketItems).toHaveLength(1);
      expect(result.current.ticketItems[0]?.quantity).toBe(1);
      expect(result.current.total).toBe(50);
      expect(result.current.ticketError).toBeNull();
    });

    it("bloquea la cantidad cuando hay una venta pendiente de confirmacion", async () => {
      const { result } = await renderReadyTerminal();
      await prepareCashCheckout(result);
      mocks.confirm.mockRejectedValueOnce(new BackendRequestError("sin respuesta", 0));
      await act(async () => result.current.confirmSale());

      act(() => result.current.setQuantity(product.productId, 4));

      expect(result.current.ticketItems[0]?.quantity).toBe(1);
      expect(result.current.total).toBe(50);
      expect(result.current.ticketError).toContain("venta pendiente de verificar");
    });
  });

  it("ante un resultado incierto conserva el confirmationId para reintentar sin duplicar", async () => {
    const { result } = await renderReadyTerminal();
    await prepareCashCheckout(result);
    mocks.confirm.mockRejectedValueOnce(new BackendRequestError("sin respuesta", 0));

    await act(async () => result.current.confirmSale());

    expect(result.current.confirmationError).toContain("Verificar resultado");
    expect(result.current.pendingConfirmation).not.toBeNull();
    const firstAttempt = mocks.confirm.mock.calls[0]?.[0].confirmationId;
    expect(result.current.confirmationId).toBe(firstAttempt);

    await act(async () => result.current.confirmSale());
    expect(mocks.confirm.mock.calls[1]?.[0].confirmationId).toBe(firstAttempt);
    expect(result.current.confirmationResult).toEqual(saleResult);
  });

  it("descarta la respuesta de una venta si cambió la sucursal mientras se confirmaba", async () => {
    const view = await renderReadyTerminal();
    await prepareCashCheckout(view.result);
    const pending = deferred<typeof saleResult>();
    mocks.confirm.mockReturnValueOnce(pending.promise);

    let confirmation!: Promise<void>;
    act(() => {
      confirmation = view.result.current.confirmSale();
    });
    mocks.branch = {
      currentBranch: { id: ids.otherBranch, tenantId: ids.tenant, name: "Norte" },
      loading: false,
    };
    view.rerender();
    await waitFor(() => expect(view.result.current.currentBranchName).toBe("Norte"));
    pending.resolve(saleResult);
    await act(async () => confirmation);

    expect(view.result.current.confirmationResult).toBeNull();
    expect(view.result.current.ticketItems).toEqual([]);
  });

  it("ignora el catálogo de una sucursal anterior que responde tarde", async () => {
    const slow = deferred<PosProductDto[]>();
    mocks.products.mockReturnValueOnce(slow.promise);
    const view = renderHook(() => usePosTerminal());
    await waitFor(() => expect(mocks.products).toHaveBeenCalledTimes(1));

    mocks.branch = {
      currentBranch: { id: ids.otherBranch, tenantId: ids.tenant, name: "Norte" },
      loading: false,
    };
    view.rerender();
    await waitFor(() => expect(view.result.current.products).toEqual([product]));
    slow.resolve([{ ...product, productId: id(77), name: "Producto viejo" }]);
    await act(async () => slow.promise);

    expect(view.result.current.products).toEqual([product]);
  });

  it("agrupa los eventos de una misma operación en una sola recarga del catálogo", async () => {
    await renderReadyTerminal();
    const before = mocks.products.mock.calls.length;

    await act(async () => {
      emit("inventory.changed");
      emit("stock.changed");
      emit("product.changed");
      await Promise.resolve();
    });

    await waitFor(() => expect(mocks.products.mock.calls.length).toBe(before + 1));
  });

  it("reutiliza el catálogo en caché al volver a abrir la misma terminal", async () => {
    const first = await renderReadyTerminal();
    expect(mocks.products).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = await renderReadyTerminal();
    expect(second.result.current.products).toEqual([product]);
    expect(mocks.products).toHaveBeenCalledTimes(1);
  });

  it("invalida la caché del catálogo cuando cambia el inventario", async () => {
    await renderReadyTerminal();
    expect(mocks.products).toHaveBeenCalledTimes(1);

    await act(async () => {
      emit("inventory.changed");
      await Promise.resolve();
    });

    await waitFor(() => expect(mocks.products).toHaveBeenCalledTimes(2));
  });

  it("refresca la caja ante cash-shift.changed", async () => {
    await renderReadyTerminal();
    const before = mocks.openShift.mock.calls.length;
    await act(async () => emit("cash-shift.changed"));
    await waitFor(() => expect(mocks.openShift.mock.calls.length).toBe(before + 1));
  });

  it("muestra errores comprensibles si fallan las cargas iniciales", async () => {
    mocks.products.mockRejectedValue(new Error("boom"));
    mocks.openShift.mockRejectedValue(new Error("boom"));
    mocks.capabilities.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePosTerminal());

    await waitFor(() =>
      expect(result.current.error).toBe("No se pudieron cargar los productos disponibles para POS."),
    );
    await waitFor(() =>
      expect(result.current.cashShiftError).toBe("No se pudo consultar el turno de caja abierto."),
    );
    await waitFor(() =>
      expect(result.current.paymentMethodsError).toBe(
        "No se pudo cargar la configuración de métodos de pago.",
      ),
    );
    expect(result.current.hasOpenCashShift).toBe(false);
  });

  it("explica que el cobro por transferencia no está disponible si el rol no accede a las cuentas", async () => {
    mocks.bankAccounts.mockRejectedValueOnce(new BackendRequestError("Forbidden", 403));
    const { result } = renderHook(() => usePosTerminal());

    await waitFor(() =>
      expect(result.current.bankAccountsError).toBe(
        "Tu rol no tiene acceso a las cuentas bancarias: el cobro por transferencia no está disponible. Usa efectivo o tarjeta.",
      ),
    );
    expect(result.current.bankAccounts).toEqual([]);
  });

  it("mantiene el mensaje genérico ante otros fallos de cuentas bancarias", async () => {
    mocks.bankAccounts.mockRejectedValueOnce(new BackendRequestError("Error", 500));
    const { result } = renderHook(() => usePosTerminal());
    await waitFor(() =>
      expect(result.current.bankAccountsError).toBe("No se pudieron cargar las cuentas bancarias disponibles."),
    );
  });

  it("no habilita el cobro sin turno abierto del usuario", async () => {
    mocks.openShift.mockResolvedValue(null);
    const { result } = renderHook(() => usePosTerminal());
    await waitFor(() => expect(result.current.cashShiftLoading).toBe(false));
    await waitFor(() => expect(result.current.products).toHaveLength(1));

    act(() => result.current.addProduct(product));
    act(() => result.current.openCheckout());
    act(() => result.current.updateCheckout({ cashReceived: 50 }));
    act(() => result.current.validateCheckout());
    await act(async () => result.current.confirmSale());

    expect(result.current.hasOpenCashShift).toBe(false);
    expect(result.current.checkoutReadyToConfirm).toBe(false);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  describe("venta con respuesta incierta", () => {
    const uncertain = () => new BackendRequestError("sin respuesta", 0);

    async function loseTheResponse() {
      const view = await renderReadyTerminal();
      await prepareCashCheckout(view.result);
      mocks.confirm.mockRejectedValueOnce(uncertain());
      await act(async () => view.result.current.confirmSale());
      const original = mocks.confirm.mock.calls[0]?.[0];
      return { ...view, original };
    }

    it("conserva la solicitud original y bloquea editar el ticket", async () => {
      const { result, original } = await loseTheResponse();

      expect(result.current.pendingConfirmation).toMatchObject({
        confirmationId: original.confirmationId,
        itemCount: 1,
        total: 50,
      });
      act(() => result.current.addProduct(product));

      expect(result.current.ticketItems).toHaveLength(1);
      expect(result.current.ticketItems[0]?.quantity).toBe(1);
      expect(result.current.ticketError).toContain("venta pendiente de verificar");

      await act(async () => result.current.retryPendingConfirmation());
      expect(mocks.confirm).toHaveBeenCalledTimes(2);
      expect(mocks.confirm.mock.calls[1]?.[0]).toEqual(original);
      expect(result.current.confirmationResult).toEqual(saleResult);
      expect(result.current.pendingConfirmation).toBeNull();
    });

    it("bloquea modificar el cobro y reenvia el mismo contenido y la misma clave", async () => {
      const { result, original } = await loseTheResponse();

      act(() => result.current.updateCheckout({ cashReceived: 80 }));
      act(() => result.current.clearTicket());
      act(() => result.current.removeItem(ids.product));

      expect(result.current.ticketItems).toHaveLength(1);
      expect(result.current.checkout.cashReceived).toBe(50);

      await act(async () => result.current.confirmSale());
      expect(mocks.confirm.mock.calls[1]?.[0]).toEqual(original);
      expect(mocks.confirm.mock.calls[1]?.[0].confirmationId).toBe(original.confirmationId);
    });

    it("sobrevive a una recarga: se recupera y se reenvia sin depender del ticket en pantalla", async () => {
      const first = await loseTheResponse();
      const { original } = first;
      first.unmount();

      const reloaded = renderHook(() => usePosTerminal());
      await waitFor(() => expect(reloaded.result.current.hasOpenCashShift).toBe(true));
      await waitFor(() => expect(reloaded.result.current.pendingConfirmation).not.toBeNull());
      expect(reloaded.result.current.ticketItems).toEqual([]);
      expect(reloaded.result.current.pendingConfirmation?.confirmationId).toBe(original.confirmationId);

      await act(async () => reloaded.result.current.retryPendingConfirmation());

      expect(mocks.confirm).toHaveBeenCalledTimes(2);
      expect(mocks.confirm.mock.calls[1]?.[0]).toEqual(original);
      expect(reloaded.result.current.confirmationResult).toEqual(saleResult);
      expect(reloaded.result.current.pendingConfirmation).toBeNull();
      expect(window.sessionStorage.length).toBe(0);
    });

    it("sigue pendiente si el reintento vuelve a quedar incierto o falla localmente", async () => {
      const { result } = await loseTheResponse();

      mocks.confirm.mockRejectedValueOnce(uncertain());
      await act(async () => result.current.retryPendingConfirmation());
      expect(result.current.pendingConfirmation).not.toBeNull();

      mocks.confirm.mockRejectedValueOnce(new Error("El precio de Producto POS cambió."));
      await act(async () => result.current.retryPendingConfirmation());
      expect(result.current.pendingConfirmation).not.toBeNull();
      expect(result.current.confirmationError).toContain("cambió");
    });

    it("un rechazo (401/403/409) del reintento NO descarta una venta que pudo registrarse", async () => {
      const { result } = await loseTheResponse();

      for (const status of [401, 403, 409]) {
        mocks.confirm.mockRejectedValueOnce(new BackendRequestError("Rechazado", status));
        await act(async () => result.current.retryPendingConfirmation());

        expect(result.current.pendingConfirmation).not.toBeNull();
        expect(result.current.confirmationError).toContain("sigue pendiente");
      }
      expect(window.sessionStorage.length).toBe(1);
    });

    it("permite descartar manualmente y vuelve a habilitar la edición", async () => {
      const { result } = await loseTheResponse();

      act(() => result.current.discardPendingConfirmation());

      expect(result.current.pendingConfirmation).toBeNull();
      expect(window.sessionStorage.length).toBe(0);
      act(() => result.current.addProduct(product));
      expect(result.current.ticketItems[0]?.quantity).toBe(2);
    });

    it("guarda la solicitud ANTES de enviar y la recupera si la página se cierra con el POST en vuelo", async () => {
      const view = await renderReadyTerminal();
      await prepareCashCheckout(view.result);
      let storedAtSend = 0;
      mocks.confirm.mockImplementationOnce(() => {
        storedAtSend = window.sessionStorage.length;
        return new Promise(() => undefined); // la respuesta nunca llega
      });
      act(() => {
        void view.result.current.confirmSale();
      });
      await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
      const original = mocks.confirm.mock.calls[0]?.[0];
      expect(storedAtSend).toBe(1);
      view.unmount();

      const reloaded = renderHook(() => usePosTerminal());
      await waitFor(() => expect(reloaded.result.current.pendingConfirmation).not.toBeNull());
      await waitFor(() => expect(reloaded.result.current.hasOpenCashShift).toBe(true));
      await act(async () => reloaded.result.current.retryPendingConfirmation());

      expect(mocks.confirm.mock.calls[1]?.[0]).toEqual(original);
      expect(reloaded.result.current.confirmationResult).toEqual(saleResult);
      expect(window.sessionStorage.length).toBe(0);
    });

    it("no envía la venta si no puede garantizar su recuperación", async () => {
      const { result } = await renderReadyTerminal();
      await prepareCashCheckout(result);
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      await act(async () => result.current.confirmSale());
      setItem.mockRestore();

      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(result.current.confirmationError).toContain("no se envió");
      expect(result.current.pendingConfirmation).toBeNull();
      expect(result.current.ticketItems).toHaveLength(1);
    });

    it("el rechazo del PRIMER envío sí libera la edición", async () => {
      const { result } = await renderReadyTerminal();
      await prepareCashCheckout(result);
      mocks.confirm.mockRejectedValueOnce(new BackendRequestError("Sesión expirada", 401));

      await act(async () => result.current.confirmSale());

      expect(result.current.pendingConfirmation).toBeNull();
      expect(window.sessionStorage.length).toBe(0);
    });

    it("un cambio de turno no oculta la venta pendiente ni permite reenviarla en otro turno", async () => {
      const view = await loseTheResponse();
      view.unmount();
      const newShift = { ...openShift(), id: id(777) };
      mocks.openShift.mockResolvedValue(newShift);

      const reloaded = renderHook(() => usePosTerminal());
      await waitFor(() => expect(reloaded.result.current.cashShift?.id).toBe(newShift.id));
      await waitFor(() => expect(reloaded.result.current.pendingConfirmation).not.toBeNull());
      await act(async () => reloaded.result.current.retryPendingConfirmation());

      expect(mocks.confirm).toHaveBeenCalledTimes(1);
      expect(reloaded.result.current.confirmationError).toContain("otro turno de caja");
      expect(reloaded.result.current.pendingConfirmation).not.toBeNull();
    });

    it("un rechazo 4xx de una venta nueva no deja nada pendiente", async () => {
      const { result } = await renderReadyTerminal();
      await prepareCashCheckout(result);
      mocks.confirm.mockRejectedValueOnce(new BackendRequestError("Stock insuficiente", 409));

      await act(async () => result.current.confirmSale());

      expect(result.current.pendingConfirmation).toBeNull();
      expect(window.sessionStorage.length).toBe(0);
    });
  });
});
