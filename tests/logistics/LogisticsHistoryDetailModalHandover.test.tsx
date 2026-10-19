import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeliveryMethod, OrderStatus } from "@/core/enums";
import type { StorePickupHandoverResult } from "@/core/repositories";
import type {
  LogisticsHistoryDetailDto,
  LogisticsHistoryItemDto,
} from "@/modules/logistics/application/dto/LogisticsHistoryDto";
import { LogisticsHistoryDetailModal } from "@/modules/logistics/components/LogisticsHistoryDetailModal";

function historyItem(
  orderId = "order-a",
  overrides: Partial<LogisticsHistoryItemDto> = {},
): LogisticsHistoryItemDto {
  return {
    sourceType: "order",
    sourceId: orderId,
    orderId,
    orderReference: "POS-002",
    deliveryMethod: DeliveryMethod.store_pickup,
    operationalStatus: OrderStatus.ready_for_pickup,
    contactName: "Cliente de prueba",
    contactPhone: null,
    pickingOrderId: "picking-a",
    packingId: "packing-a",
    dispatchId: null,
    storePickupDeliveryId: null,
    pickingCompletedAt: "2026-10-18T12:00:00Z",
    packingFinalizedAt: "2026-10-18T13:00:00Z",
    dispatchedAt: null,
    deliveredAt: null,
    responsibleUserId: null,
    responsibleUserName: null,
    totalWeight: null,
    packageCount: null,
    dispatchStatus: null,
    carrierName: null,
    trackingNumber: null,
    ...overrides,
  };
}

function detail(item = historyItem()): LogisticsHistoryDetailDto {
  return { summary: item, items: [] };
}

function successfulResult(
  overrides: Partial<StorePickupHandoverResult> = {},
): StorePickupHandoverResult {
  return {
    orderId: "order-a",
    status: "delivered",
    deliveredAt: "2026-10-18T16:30:00-06:00",
    idempotent: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderDetail(options: {
  currentDetail?: LogisticsHistoryDetailDto | null;
  eligible?: boolean;
  submitting?: boolean;
  mutationInFlight?: boolean;
  handoverError?: string | null;
  handoverErrorUncertain?: boolean;
  open?: boolean;
  onConfirm?: (orderId: string) => Promise<StorePickupHandoverResult | null>;
} = {}) {
  const onConfirm = options.onConfirm ?? vi.fn(async () => successfulResult());
  const currentDetail = options.currentDetail === undefined ? detail() : options.currentDetail;
  const props = {
    detail: currentDetail,
    error: null,
    handoverEligible: options.eligible ?? true,
    handoverError: options.handoverError ?? null,
    handoverErrorUncertain: options.handoverErrorUncertain ?? false,
    handoverMutationInFlight: options.mutationInFlight ?? false,
    handoverSubmitting: options.submitting ?? false,
    loading: false,
    onClose: vi.fn(),
    onConfirmStorePickupHandover: onConfirm,
    open: options.open ?? true,
  };
  return {
    ...render(
      <LogisticsHistoryDetailModal
        key={currentDetail?.summary.orderId ?? "history-detail-closed"}
        {...props}
      />,
    ),
    onConfirm,
    props,
  };
}

function openConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: "Confirmar entrega al cliente" }));
  return screen.getByRole("dialog", { name: "Confirmar entrega al cliente" });
}

describe("LogisticsHistoryDetailModal store-pickup handover", () => {
  it("muestra la accion solo cuando el hook declara elegible al pedido", () => {
    const view = renderDetail();
    expect(screen.getByRole("button", { name: "Confirmar entrega al cliente" })).toBeEnabled();

    view.rerender(
      <LogisticsHistoryDetailModal
        key="order-a"
        {...view.props}
        handoverEligible={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Confirmar entrega al cliente" })).toBeNull();
  });

  it.each([
    historyItem("delivered", {
      operationalStatus: OrderStatus.delivered,
      deliveredAt: "2026-10-18T16:30:00-06:00",
    }),
    historyItem("home-delivery", { deliveryMethod: DeliveryMethod.home_delivery }),
  ])("no ofrece la entrega para pedidos ya entregados o domiciliarios", (item) => {
    renderDetail({ currentDetail: detail(item), eligible: false });
    expect(screen.queryByRole("button", { name: "Confirmar entrega al cliente" })).toBeNull();
  });

  it("abre el dialogo y permite cancelarlo sin ejecutar el comando", () => {
    const { onConfirm } = renderDetail();
    const dialog = openConfirmation();
    expect(dialog).toHaveTextContent("¿Confirma que el pedido fue entregado al cliente?");

    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.queryByRole("dialog", { name: "Confirmar entrega al cliente" })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("requiere confirmacion explicita y muestra el resultado autoritativo", async () => {
    const onConfirm = vi.fn(async () => successfulResult());
    renderDetail({ onConfirm });
    openConfirmation();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrega" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("order-a"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Entrega confirmada")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Confirmar entrega al cliente" })).toBeNull();
  });

  it("distingue una respuesta idempotente de una confirmacion nueva", async () => {
    renderDetail({
      onConfirm: vi.fn(async () => successfulResult({ idempotent: true })),
    });
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrega" }));

    expect(await screen.findByText("Entrega ya confirmada")).toBeInTheDocument();
    expect(screen.getByText(/ya estaba registrada/)).toBeInTheDocument();
  });

  it("muestra carga y bloquea invocaciones duplicadas antes del rerender", async () => {
    const pending = deferred<StorePickupHandoverResult | null>();
    const onConfirm = vi.fn(() => pending.promise);
    const view = renderDetail({ onConfirm });
    openConfirmation();
    const confirm = screen.getByRole("button", { name: "Confirmar entrega" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    view.rerender(
      <LogisticsHistoryDetailModal
        key="order-a"
        {...view.props}
        handoverMutationInFlight
        handoverSubmitting
      />,
    );
    expect(screen.getByRole("button", { name: "Confirmando..." })).toBeDisabled();

    await act(async () => {
      pending.resolve(successfulResult());
      await pending.promise;
    });
  });

  it("presenta por separado errores definitivos y resultados inciertos", () => {
    const view = renderDetail({ handoverError: "El pedido cambio de estado." });
    expect(screen.getByText("No se pudo confirmar la entrega")).toBeInTheDocument();
    expect(screen.getByText("El pedido cambio de estado.")).toBeInTheDocument();

    view.rerender(
      <LogisticsHistoryDetailModal
        key="order-a"
        {...view.props}
        handoverError="Se perdio la conexion."
        handoverErrorUncertain
      />,
    );
    expect(screen.getByText("No se pudo verificar la entrega")).toBeInTheDocument();
    expect(screen.getByText(/Verifica el estado actualizado/)).toBeInTheDocument();
  });

  it("impide confirmar si el pedido deja de ser elegible con el dialogo abierto", () => {
    const view = renderDetail();
    openConfirmation();
    view.rerender(
      <LogisticsHistoryDetailModal
        key="order-a"
        {...view.props}
        handoverEligible={false}
      />,
    );

    expect(screen.getByText(/El pedido dejó de ser elegible para entrega/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar entrega" })).toBeDisabled();
    expect(view.onConfirm).not.toHaveBeenCalled();
  });

  it("no publica el resultado si se cierra o cambia el detalle durante el POST", async () => {
    const pending = deferred<StorePickupHandoverResult | null>();
    const view = renderDetail({ onConfirm: vi.fn(() => pending.promise) });
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrega" }));

    view.rerender(
      <LogisticsHistoryDetailModal
        key="history-detail-closed"
        {...view.props}
        detail={null}
        handoverEligible={false}
        open={false}
      />,
    );
    await act(async () => {
      pending.resolve(successfulResult());
      await pending.promise;
    });

    expect(screen.queryByText("Entrega confirmada")).toBeNull();
  });

  it("no publica el resultado de un pedido sobre el detalle de otro", async () => {
    const pending = deferred<StorePickupHandoverResult | null>();
    const view = renderDetail({ onConfirm: vi.fn(() => pending.promise) });
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrega" }));

    const orderB = detail(historyItem("order-b", { orderReference: "POS-003" }));
    view.rerender(
      <LogisticsHistoryDetailModal
        key="order-b"
        {...view.props}
        detail={orderB}
        handoverEligible
      />,
    );
    await act(async () => {
      pending.resolve(successfulResult());
      await pending.promise;
    });

    expect(screen.getByRole("heading", { name: "POS-003" })).toBeInTheDocument();
    expect(screen.queryByText("Entrega confirmada")).toBeNull();
  });
});
