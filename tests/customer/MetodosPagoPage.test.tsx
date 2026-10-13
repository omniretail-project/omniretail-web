// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerPaymentMethod } from "@/core/entities";
import { CustomerPaymentMethodStatus, PaymentMethod } from "@/core/enums";
import { MetodosPagoPage } from "@/modules/customer/pages/MetodosPagoPage";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setDefault: vi.fn(),
  showToast: vi.fn(),
  paymentMethods: [] as unknown[],
}));

vi.mock("@/shared/components/Toast", () => ({
  useToast: () => ({ showToast: state.showToast }),
}));
vi.mock("@/modules/customer/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    paymentMethods: state.paymentMethods,
    loading: false,
    busy: false,
    error: null,
    reload: vi.fn(),
    create: state.create,
    update: state.update,
    remove: state.remove,
    setDefault: state.setDefault,
  }),
}));

const DISCOVER_CARD: CustomerPaymentMethod = {
  id: "cpm-discover",
  tenantId: "tenant-demo",
  customerId: "customer-ana",
  type: PaymentMethod.card,
  brand: "Discover",
  issuingBank: "Banco Industrial",
  last4: "1117",
  expirationMonth: 5,
  expirationYear: 2028,
  isDefault: false,
  status: CustomerPaymentMethodStatus.active,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function openNewCard() {
  fireEvent.click(screen.getAllByRole("button", { name: "Nueva tarjeta" })[0]);
  return screen.findByLabelText("Número de tarjeta");
}

describe("MetodosPagoPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15));
    state.paymentMethods = [];
    state.create.mockReset().mockResolvedValue({});
    state.update.mockReset().mockResolvedValue({});
    state.remove.mockReset().mockResolvedValue(undefined);
    state.showToast.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pide los mismos campos que el checkout y no tiene selector de marca", async () => {
    render(<MetodosPagoPage />);
    const cardNumber = await openNewCard();

    expect(cardNumber).toHaveAttribute("autocomplete", "cc-number");
    expect(screen.getByLabelText("Nombre del titular")).toHaveAttribute("autocomplete", "cc-name");
    expect(screen.getByLabelText("Fecha de vencimiento")).toHaveAttribute("autocomplete", "cc-exp");
    const cvv = screen.getByLabelText("Código de seguridad (CVV)");
    expect(cvv).toHaveAttribute("autocomplete", "cc-csc");
    expect(cvv).toHaveAttribute("type", "password");
    expect(cvv).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("Banco emisor")).toBeInTheDocument();
    expect(screen.queryByLabelText("Marca")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Últimos 4 dígitos")).not.toBeInTheDocument();
  });

  it("detecta la marca, formatea AmEx 4-6-5 y ajusta el CVV a 4 dígitos", async () => {
    render(<MetodosPagoPage />);
    await openNewCard();

    type("Número de tarjeta", "378282246310005");
    expect(screen.getByLabelText("Número de tarjeta")).toHaveValue("3782 822463 10005");
    expect(screen.getByText("American Express")).toBeInTheDocument();
    expect(screen.getByLabelText("Código de seguridad (CVV)")).toHaveAttribute("maxlength", "4");
  });

  it("no guarda con datos inválidos", async () => {
    render(<MetodosPagoPage />);
    await openNewCard();

    type("Número de tarjeta", "6011111111111117");
    type("Nombre del titular", "Ana López");
    type("Fecha de vencimiento", "0926");
    type("Código de seguridad (CVV)", "12");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("Solo se aceptan tarjetas Visa, Mastercard o American Express."),
    ).toBeInTheDocument();
    expect(screen.getByText("La tarjeta está vencida.")).toBeInTheDocument();
    expect(screen.getByText("Ingresa un código de seguridad de 3 dígitos.")).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("guarda y limpia el número y el CVV del formulario", async () => {
    state.create.mockRejectedValueOnce(new Error("Falló el guardado"));
    render(<MetodosPagoPage />);
    await openNewCard();

    type("Número de tarjeta", "5555555555554444");
    type("Nombre del titular", "Ana López");
    type("Fecha de vencimiento", "1230");
    type("Código de seguridad (CVV)", "123");
    fireEvent.change(screen.getByLabelText("Banco emisor"), {
      target: { value: "Banco Industrial" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith({
        cardNumber: "5555 5555 5555 4444",
        cardholderName: "Ana López",
        expiration: "12/30",
        cvv: "123",
        issuingBank: "Banco Industrial",
      }),
    );
    // Aunque el guardado falle, el número y el CVV ya no quedan en el estado.
    await waitFor(() => expect(screen.getByLabelText("Número de tarjeta")).toHaveValue(""));
    expect(screen.getByLabelText("Código de seguridad (CVV)")).toHaveValue("");
    expect(screen.getByLabelText("Nombre del titular")).toHaveValue("Ana López");
  });

  it("al cancelar descarta el número y el CVV", async () => {
    render(<MetodosPagoPage />);
    await openNewCard();
    type("Número de tarjeta", "4242424242424242");
    type("Código de seguridad (CVV)", "123");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await openNewCard();

    expect(screen.getByLabelText("Número de tarjeta")).toHaveValue("");
    expect(screen.getByLabelText("Código de seguridad (CVV)")).toHaveValue("");
  });

  it("al cancelar y reabrir no quedan mensajes de error", async () => {
    render(<MetodosPagoPage />);
    await openNewCard();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Ingrese el número de tarjeta.")).toBeInTheDocument();
    expect(screen.getByText("Ingrese el nombre del titular.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    // Se comprueba en el mismo tick de la reapertura, antes del reinicio
    // diferido del formulario: los errores ya deben haberse limpiado al cerrar.
    fireEvent.click(screen.getAllByRole("button", { name: "Nueva tarjeta" })[0]);

    expect(screen.getByLabelText("Número de tarjeta")).toBeInTheDocument();
    expect(screen.queryByText("Ingrese el número de tarjeta.")).not.toBeInTheDocument();
    expect(screen.queryByText("Ingrese el nombre del titular.")).not.toBeInTheDocument();
    expect(screen.queryByText("Ingresa una fecha válida en formato MM/AA.")).not.toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("una tarjeta Discover guardada se muestra, se edita y se elimina", async () => {
    state.paymentMethods = [DISCOVER_CARD];
    render(<MetodosPagoPage />);

    expect(screen.getByText("Discover")).toBeInTheDocument();
    expect(screen.getByText("•••• 1117")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(await screen.findByText("Discover •••• 1117")).toBeInTheDocument();
    expect(screen.queryByLabelText("Número de tarjeta")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Código de seguridad (CVV)")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Fecha de vencimiento")).toHaveValue("05/28"));

    type("Fecha de vencimiento", "0631");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(
        "cpm-discover",
        expect.objectContaining({ expiration: "06/31", cardholderName: "" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const dialogButtons = await screen.findAllByRole("button", { name: "Eliminar" });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith("cpm-discover"));
  });
});
