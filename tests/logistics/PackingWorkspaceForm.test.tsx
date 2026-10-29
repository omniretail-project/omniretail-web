import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeliveryMethod, PackingStatus } from "@/core/enums";
import type { PackingDetailDto } from "@/modules/logistics/application/dto/PackingReadModelDto";
import { mergePackingFormValues, PackingWorkspace } from "@/modules/logistics/components/PackingWorkspace";

const PROTECTED = "Empaque sin daños y productos protegidos.";

function packing(overrides: Partial<PackingDetailDto> = {}): PackingDetailDto {
  return {
    packingId: "60000000-0000-4000-8000-000000000001",
    orderId: "60000000-0000-4000-8000-000000000002",
    orderReference: "ORD-700",
    customerName: "Cliente",
    storePickupContact: null,
    deliveryMethod: DeliveryMethod.home_delivery,
    status: PackingStatus.in_progress,
    version: 1,
    startedAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
    pickingOrderId: "60000000-0000-4000-8000-000000000003",
    orderStatus: null,
    deliveryAddress: null,
    checklist: {
      packageProtectionChecked: false,
      documentIncludedChecked: false,
      recipientVerifiedChecked: false,
    },
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

function workspace(detail: PackingDetailDto | null, overrides: Partial<Parameters<typeof PackingWorkspace>[0]> = {}) {
  return (
    <PackingWorkspace
      apiPacking
      canFinalize
      canPrepare
      completion={null}
      detail={detail}
      error={null}
      handoverAvailable={false}
      loading={false}
      onConfirmStorePickupDelivery={vi.fn(async () => true)}
      onFinalize={vi.fn(async () => true)}
      onGenerateLabel={vi.fn(async () => true)}
      onRegisterLabelPrint={vi.fn(async () => true)}
      onSave={vi.fn(async () => true)}
      selected
      submitting={false}
      {...overrides}
    />
  );
}

describe("mergePackingFormValues", () => {
  const server = (overrides: Partial<ReturnType<typeof formValues>> = {}) => ({ ...formValues(), ...overrides });
  function formValues() {
    return {
      checklist: { packageProtectionChecked: false, documentIncludedChecked: false, recipientVerifiedChecked: false },
      totalWeight: "",
      packageCount: "",
    };
  }

  it("adopta el valor del servidor en los campos que el usuario no toco", () => {
    const previous = server();
    const next = server({ totalWeight: "3.5", checklist: { ...formValues().checklist, documentIncludedChecked: true } });

    const merged = mergePackingFormValues(previous, previous, next);

    expect(merged.totalWeight).toBe("3.5");
    expect(merged.checklist.documentIncludedChecked).toBe(true);
  });

  it("conserva lo que el usuario esta editando aunque el servidor traiga otra version", () => {
    const previous = server();
    const edited = server({ packageCount: "4", checklist: { ...formValues().checklist, packageProtectionChecked: true } });
    const next = server({ packageCount: "9", totalWeight: "2", checklist: { ...formValues().checklist, packageProtectionChecked: false } });

    const merged = mergePackingFormValues(edited, previous, next);

    expect(merged.packageCount).toBe("4");
    expect(merged.checklist.packageProtectionChecked).toBe(true);
    expect(merged.totalWeight).toBe("2");
  });
});

describe("PackingWorkspace: una nueva version del pedido no reconstruye el formulario", () => {
  it("conserva los campos no enviados y el mismo nodo DOM al llegar la version siguiente", () => {
    const view = render(workspace(packing()));
    const weight = screen.getByLabelText("Peso total (kg)") as HTMLInputElement;
    fireEvent.change(weight, { target: { value: "2.5" } });

    view.rerender(workspace(packing({
      version: 2,
      checklist: { packageProtectionChecked: true, documentIncludedChecked: false, recipientVerifiedChecked: false },
    })));

    expect(screen.getByLabelText("Peso total (kg)")).toBe(weight);
    expect(weight).toHaveValue(2.5);
    // Lo que no se estaba editando adopta el dato real devuelto por el backend.
    expect(screen.getByRole("checkbox", { name: PROTECTED })).toBeChecked();
  });

  it("no pisa una casilla que el usuario marco mientras llegaba la version nueva", () => {
    const view = render(workspace(packing()));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ticket o factura agregado al paquete." }));

    view.rerender(workspace(packing({ version: 2 })));

    expect(screen.getByRole("checkbox", { name: "Ticket o factura agregado al paquete." })).toBeChecked();
  });

  it("refleja los valores guardados cuando el usuario no tenia cambios", () => {
    const view = render(workspace(packing()));

    view.rerender(workspace(packing({ version: 2, totalWeight: 4.25, packageCount: 3 })));

    expect(screen.getByLabelText("Peso total (kg)")).toHaveValue(4.25);
    expect(screen.getByLabelText("Cantidad de bultos")).toHaveValue(3);
  });

  it("un refresco con el detalle visible no lo reemplaza por el cargando y lo indica discretamente", () => {
    const view = render(workspace(packing()));

    view.rerender(workspace(packing(), { loading: true }));

    expect(screen.queryByText("Cargando preparación...")).not.toBeInTheDocument();
    expect(screen.getByText("Resultado y etiqueta")).toBeInTheDocument();
    expect(screen.getByText("Actualizando...")).toBeInTheDocument();
  });

  it("sin detalle muestra el cargando de la seleccion inicial", () => {
    render(workspace(null, { loading: true }));

    expect(screen.getByText("Cargando preparación...")).toBeInTheDocument();
  });

  it("indica el guardado en curso sin desmontar el formulario", () => {
    const view = render(workspace(packing()));
    const weight = screen.getByLabelText("Peso total (kg)");

    view.rerender(workspace(packing(), { submitting: true }));

    expect(screen.getByText("Guardando cambios...")).toBeInTheDocument();
    expect(screen.getByLabelText("Peso total (kg)")).toBe(weight);
  });

  it("cambiar de preparacion si reinicia el formulario", () => {
    const view = render(workspace(packing()));
    fireEvent.change(screen.getByLabelText("Peso total (kg)"), { target: { value: "8" } });

    view.rerender(workspace(packing({ packingId: "60000000-0000-4000-8000-0000000000aa", orderReference: "ORD-701" })));

    expect(screen.getByLabelText("Peso total (kg)")).toHaveValue(null);
  });
});
