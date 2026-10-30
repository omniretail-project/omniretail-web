import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportMode } from "@/core/enums";
import { DispatchReadPanel } from "@/modules/logistics/components/DispatchReadPanel";
import type { useLogisticsDispatchRead } from "@/modules/logistics/hooks/useLogisticsDispatchRead";
import { id, ids, preparedDto, queueDtos } from "./dispatchFixtures";

const mocks = vi.hoisted(() => ({
  useDispatch: vi.fn(),
}));

vi.mock("@/modules/logistics/hooks/useLogisticsDispatchRead", () => ({
  useLogisticsDispatchRead: () => mocks.useDispatch(),
}));

function createDispatchState(
  overrides: Partial<ReturnType<typeof useLogisticsDispatchRead>> = {},
): ReturnType<typeof useLogisticsDispatchRead> {
  return {
    currentBranchName: "Central",
    hasBranchAccess: true,
    canRead: true,
    canConfirm: true,
    loading: false,
    detailLoading: false,
    mutationInFlight: false,
    submittingSourceId: null,
    queue: queueDtos,
    orders: [queueDtos[0]!],
    transfers: [queueDtos[1]!],
    selectedOrderId: null,
    detail: null,
    error: null,
    success: null,
    reload: vi.fn(async () => undefined),
    selectOrder: vi.fn(async () => undefined),
    clearSelection: vi.fn(),
    confirmOrder: vi.fn(async () => null),
    confirmTransfer: vi.fn(async () => null),
    ...overrides,
  };
}

describe("DispatchReadPanel", () => {
  beforeEach(() => {
    mocks.useDispatch.mockReset();
    mocks.useDispatch.mockReturnValue(createDispatchState());
  });

  it("renders permission and branch-scope denials", () => {
    mocks.useDispatch.mockReturnValue(createDispatchState({ canRead: false }));
    const { rerender } = render(<DispatchReadPanel />);
    expect(screen.getByText("Acceso no autorizado")).toBeInTheDocument();

    mocks.useDispatch.mockReturnValue(createDispatchState({ hasBranchAccess: false }));
    rerender(<DispatchReadPanel />);
    expect(screen.getByText("Sucursal no disponible")).toBeInTheDocument();
  });

  it("renders loading, errors and success without a manual refresh button", () => {
    mocks.useDispatch.mockReturnValue(createDispatchState({
      loading: true,
      error: "Queue failed",
      success: "Dispatch confirmed",
    }));
    render(<DispatchReadPanel />);

    expect(screen.getByText("Consultando salidas...")).toBeInTheDocument();
    expect(screen.getByText("Queue failed")).toBeInTheDocument();
    expect(screen.getByText("Dispatch confirmed")).toBeInTheDocument();
    // La pantalla se sincroniza sola (eventos internos + respaldo periodico): ya no hay boton «Actualizar».
    expect(screen.queryByRole("button", { name: "Actualizar" })).not.toBeInTheDocument();
  });

  it("renders an empty queue", () => {
    mocks.useDispatch.mockReturnValue(createDispatchState({
      queue: [],
      orders: [],
      transfers: [],
    }));
    render(<DispatchReadPanel />);

    expect(screen.getByText(/No hay pedidos ni traslados/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actualizar" })).not.toBeInTheDocument();
  });

  it("selecting an order asks the hook for its detail", () => {
    const selectOrder = vi.fn(async () => undefined);
    mocks.useDispatch.mockReturnValue(createDispatchState({ selectOrder }));
    render(<DispatchReadPanel />);

    const toggle = screen.getByRole("button", { name: "Ver detalle" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(selectOrder).toHaveBeenCalledWith(ids.order);
  });

  it("loads order detail and confirms a valid third-party shipment", async () => {
    const confirmOrder = vi.fn(async () => null);
    mocks.useDispatch.mockReturnValue(createDispatchState({
      selectedOrderId: ids.order,
      detail: preparedDto,
      confirmOrder,
    }));
    render(<DispatchReadPanel />);

    expect(screen.getAllByText("No disponible")).toHaveLength(2);
    expect(screen.getAllByText(/Transporte externo/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar despacho" }));
    expect(confirmOrder).not.toHaveBeenCalled();
    expect(screen.getAllByText(/obligatorio/i)).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Transportista *"), {
      target: { value: " Carrier " },
    });
    fireEvent.change(screen.getByLabelText("Número de guía *"), {
      target: { value: " TRACK-1 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar despacho" }));

    await waitFor(() => expect(confirmOrder).toHaveBeenCalledWith({
      carrierName: "Carrier",
      trackingNumber: "TRACK-1",
    }));
  });

  it("confirms transfers and reflects the global mutation lock", () => {
    const confirmTransfer = vi.fn(async () => null);
    mocks.useDispatch.mockReturnValue(createDispatchState({
      mutationInFlight: true,
      submittingSourceId: ids.transfer,
      confirmTransfer,
    }));
    const { rerender } = render(<DispatchReadPanel />);

    expect(screen.getByRole("button", { name: "Confirmando..." })).toBeDisabled();

    mocks.useDispatch.mockReturnValue(createDispatchState({ confirmTransfer }));
    rerender(<DispatchReadPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar salida" }));
    expect(confirmTransfer).toHaveBeenCalledWith(ids.transfer, "TRF-100");
  });

  it("renders own-fleet detail without shipment fields and disables confirmation by permission", () => {
    mocks.useDispatch.mockReturnValue(createDispatchState({
      canConfirm: false,
      selectedOrderId: ids.order,
      detail: { ...preparedDto, transportMode: TransportMode.own_fleet },
    }));
    render(<DispatchReadPanel />);

    expect(screen.getByText(/flota propia configurada/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Transportista")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar despacho" })).toBeDisabled();
    expect(screen.getByText(/no posee logistics.dispatch.confirm/)).toBeInTheDocument();
  });

  describe("detalle expandible bajo el pedido seleccionado", () => {
    const secondOrder = {
      ...queueDtos[0]!,
      orderId: id(30),
      sourceId: id(30),
      sourceReference: "ORD-200",
    };
    const threeOrders = [queueDtos[0]!, secondOrder, { ...secondOrder, orderId: id(31), sourceId: id(31), sourceReference: "ORD-300" }];

    function cardOf(reference: string) {
      return screen.getByText(reference, { selector: "p.font-semibold" }).closest("div.rounded-lg") as HTMLElement;
    }

    it("muestra el detalle dentro de la tarjeta del pedido seleccionado y no en las demas", () => {
      mocks.useDispatch.mockReturnValue(createDispatchState({
        orders: threeOrders,
        queue: threeOrders,
        transfers: [],
        selectedOrderId: secondOrder.orderId,
        detail: { ...preparedDto, orderId: secondOrder.orderId, orderReference: "ORD-200" },
      }));
      render(<DispatchReadPanel />);

      const region = screen.getByRole("region", { name: "Detalle del pedido ORD-200" });
      expect(cardOf("ORD-200")).toContainElement(region);
      expect(cardOf("ORD-100")).not.toContainElement(region);
      expect(cardOf("ORD-300")).not.toContainElement(region);
      expect(screen.getAllByRole("region")).toHaveLength(1);
      // Orden en pantalla: pedido 001, pedido 002 con su detalle, pedido 003.
      const order = screen.getAllByText(/^ORD-/, { selector: "p.font-semibold" }).map((node) => node.textContent);
      expect(order).toEqual(["ORD-100", "ORD-200", "ORD-300"]);
    });

    it("expone aria-expanded y aria-controls que apuntan al detalle", () => {
      mocks.useDispatch.mockReturnValue(createDispatchState({
        orders: threeOrders,
        queue: threeOrders,
        transfers: [],
        selectedOrderId: secondOrder.orderId,
        detail: { ...preparedDto, orderId: secondOrder.orderId, orderReference: "ORD-200" },
      }));
      render(<DispatchReadPanel />);

      const toggles = screen.getAllByRole("button", { name: /Ver detalle|Ocultar detalle/ });
      expect(toggles.map((toggle) => toggle.getAttribute("aria-expanded"))).toEqual(["false", "true", "false"]);
      const expanded = screen.getByRole("button", { name: "Ocultar detalle" });
      const region = screen.getByRole("region", { name: "Detalle del pedido ORD-200" });
      expect(expanded.getAttribute("aria-controls")).toBe(region.id);
      expect(document.getElementById(expanded.getAttribute("aria-controls")!)).toBe(region);
    });

    it("hay un solo formulario de confirmacion aunque haya varios pedidos", () => {
      mocks.useDispatch.mockReturnValue(createDispatchState({
        orders: threeOrders,
        queue: threeOrders,
        transfers: [],
        selectedOrderId: secondOrder.orderId,
        detail: { ...preparedDto, orderId: secondOrder.orderId, orderReference: "ORD-200" },
      }));
      render(<DispatchReadPanel />);

      expect(screen.getAllByRole("button", { name: "Confirmar despacho" })).toHaveLength(1);
      expect(screen.getAllByLabelText("Transportista *")).toHaveLength(1);
    });

    it("se puede cerrar con el boton del pedido o con «Cerrar»", () => {
      const clearSelection = vi.fn();
      mocks.useDispatch.mockReturnValue(createDispatchState({
        selectedOrderId: ids.order,
        detail: preparedDto,
        clearSelection,
      }));
      render(<DispatchReadPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Ocultar detalle" }));
      fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

      expect(clearSelection).toHaveBeenCalledTimes(2);
    });

    it("seleccionar otro pedido pide su detalle y el anterior deja de mostrarse", () => {
      const selectOrder = vi.fn(async () => undefined);
      mocks.useDispatch.mockReturnValue(createDispatchState({
        orders: threeOrders,
        queue: threeOrders,
        transfers: [],
        selectedOrderId: ids.order,
        detail: preparedDto,
        selectOrder,
      }));
      const { rerender } = render(<DispatchReadPanel />);
      fireEvent.click(screen.getAllByRole("button", { name: "Ver detalle" })[0]!);
      expect(selectOrder).toHaveBeenCalledWith(secondOrder.orderId);

      mocks.useDispatch.mockReturnValue(createDispatchState({
        orders: threeOrders,
        queue: threeOrders,
        transfers: [],
        selectedOrderId: secondOrder.orderId,
        detail: { ...preparedDto, orderId: secondOrder.orderId, orderReference: "ORD-200" },
        selectOrder,
      }));
      rerender(<DispatchReadPanel />);

      expect(screen.queryByRole("region", { name: "Detalle del pedido ORD-100" })).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Detalle del pedido ORD-200" })).toBeInTheDocument();
    });

    it("muestra la carga del detalle dentro de la tarjeta mientras se consulta", () => {
      mocks.useDispatch.mockReturnValue(createDispatchState({
        selectedOrderId: ids.order,
        detail: null,
        detailLoading: true,
      }));
      render(<DispatchReadPanel />);

      const region = screen.getByRole("region", { name: "Detalle del pedido ORD-100" });
      expect(region).toHaveTextContent("Consultando detalle...");
      expect(screen.queryByRole("button", { name: "Confirmar despacho" })).not.toBeInTheDocument();
    });

    it("conserva el bloqueo por mutacion en curso en los botones del pedido", () => {
      mocks.useDispatch.mockReturnValue(createDispatchState({
        mutationInFlight: true,
        selectedOrderId: ids.order,
        detail: preparedDto,
      }));
      render(<DispatchReadPanel />);

      expect(screen.getByRole("button", { name: "Ocultar detalle" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cerrar" })).toBeDisabled();
    });
  });
});
