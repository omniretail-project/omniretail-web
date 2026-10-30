import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrderStatus, TransportMode } from "@/core/enums";
import type { PreparedOrderDetailDto } from "@/modules/logistics/application/dto/DispatchReadModelDto";
import { LogisticsHistoryDispatchModal } from "@/modules/logistics/components/LogisticsHistoryDispatchModal";
import type { DispatchShipmentValidationResult } from "@/modules/logistics/validation/dispatch.validation";

type ConfirmDispatch = (validation: DispatchShipmentValidationResult) => Promise<boolean>;

function detail(
  orderReference: string,
  transportMode: TransportMode,
): PreparedOrderDetailDto {
  return {
    orderId: "10000000-0000-4000-8000-000000000001",
    orderReference,
    createdAt: "2026-10-29T10:00:00-06:00",
    recipientName: "Cliente",
    recipientPhone: "55555555",
    address: null,
    transportMode,
    notificationContact: { emailMode: "not_applicable" },
    pickingOrderId: "10000000-0000-4000-8000-000000000002",
    pickingCompletedAt: "2026-10-29T11:00:00-06:00",
    orderStatus: OrderStatus.ready_for_dispatch,
    pickingStatus: "completed",
  };
}

function renderModal(
  preparedDetail: PreparedOrderDetailDto,
  onConfirm = vi.fn<ConfirmDispatch>().mockResolvedValue(true),
) {
  render(
    <LogisticsHistoryDispatchModal
      detail={preparedDetail}
      error={null}
      loading={false}
      onClose={vi.fn()}
      onConfirm={onConfirm}
      open
      submitting={false}
    />,
  );
  return onConfirm;
}

describe("LogisticsHistoryDispatchModal", () => {
  it("respeta own_fleet aunque la referencia del pedido sea POS", async () => {
    const onConfirm = renderModal(detail("POS-017", TransportMode.own_fleet));

    expect(screen.getByText("Flota propia")).toBeInTheDocument();
    expect(screen.getByText("Para flota propia, el transporte y la guía son opcionales.")).toBeInTheDocument();
    expect(screen.getByLabelText("Transporte")).toBeInTheDocument();
    expect(screen.getByLabelText("Guía / tracking")).toBeInTheDocument();
    expect(screen.getAllByText("Opcional para flota propia")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar despacho" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      valid: true,
      errors: {},
      carrierName: undefined,
      trackingNumber: undefined,
    }));
  });

  it("exige los datos de salida cuando el pedido POS usa transporte externo", async () => {
    const onConfirm = renderModal(detail("POS-017", TransportMode.third_party));

    expect(screen.getByText("Transporte externo")).toBeInTheDocument();
    expect(screen.getByText("El transporte y el número de guía son obligatorios.")).toBeInTheDocument();
    expect(screen.getByLabelText("Transporte *")).toBeInTheDocument();
    expect(screen.getByLabelText("Guía / tracking *")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar despacho" }));

    expect(await screen.findByText("El transporte es obligatorio.")).toBeInTheDocument();
    expect(screen.getByText("El número de guía es obligatorio.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("conserva la presentacion existente para ecommerce con flota propia", () => {
    renderModal(detail("WEB-017", TransportMode.own_fleet));

    expect(screen.getByText("Flota propia")).toBeInTheDocument();
    expect(screen.getByText("Para flota propia, el transporte y la guía son opcionales.")).toBeInTheDocument();
    expect(screen.getByLabelText("Transporte")).toBeInTheDocument();
    expect(screen.getByLabelText("Guía / tracking")).toBeInTheDocument();
  });

  it("conserva la presentacion y obligatoriedad existentes para third_party", () => {
    renderModal(detail("WEB-018", TransportMode.third_party));

    expect(screen.getByText("Transporte externo")).toBeInTheDocument();
    expect(screen.getByText("El transporte y el número de guía son obligatorios.")).toBeInTheDocument();
    expect(screen.getByLabelText("Transporte *")).toBeInTheDocument();
    expect(screen.getByLabelText("Guía / tracking *")).toBeInTheDocument();
  });
});
