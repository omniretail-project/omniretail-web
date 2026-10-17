import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportMode } from "@/core/enums";
import { DispatchReadPanel } from "@/modules/logistics/components/DispatchReadPanel";
import type { useLogisticsDispatchRead } from "@/modules/logistics/hooks/useLogisticsDispatchRead";
import { ids, preparedDto, queueDtos } from "./dispatchFixtures";

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

  it("renders loading, errors, success and refresh behavior", () => {
    const reload = vi.fn(async () => undefined);
    mocks.useDispatch.mockReturnValue(createDispatchState({
      loading: true,
      error: "Queue failed",
      success: "Dispatch confirmed",
      reload,
    }));
    render(<DispatchReadPanel />);

    expect(screen.getByText("Consultando salidas...")).toBeInTheDocument();
    expect(screen.getByText("Queue failed")).toBeInTheDocument();
    expect(screen.getByText("Dispatch confirmed")).toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: "Actualizar" });
    expect(refresh).toBeDisabled();
  });

  it("renders an empty queue and allows manual reload", () => {
    const reload = vi.fn(async () => undefined);
    mocks.useDispatch.mockReturnValue(createDispatchState({
      queue: [],
      orders: [],
      transfers: [],
      reload,
    }));
    render(<DispatchReadPanel />);

    expect(screen.getByText(/No hay pedidos ni traslados/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("loads order detail and confirms a valid third-party shipment", async () => {
    const selectOrder = vi.fn(async () => undefined);
    const confirmOrder = vi.fn(async () => null);
    mocks.useDispatch.mockReturnValue(createDispatchState({
      selectedOrderId: ids.order,
      detail: preparedDto,
      selectOrder,
      confirmOrder,
    }));
    render(<DispatchReadPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Ver detalle" }));
    expect(selectOrder).toHaveBeenCalledWith(ids.order);
    expect(screen.getAllByText("No disponible")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar despacho" }));
    expect(confirmOrder).not.toHaveBeenCalled();
    expect(screen.getAllByText(/obligatorio/i)).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Transportista"), {
      target: { value: " Carrier " },
    });
    fireEvent.change(screen.getByLabelText(/mero de gu/i), {
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
});
