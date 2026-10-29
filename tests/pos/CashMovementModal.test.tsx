import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CashMovementType } from "@/core/enums";
import { CashMovementModal } from "@/modules/pos/components/CashMovementModal";

type ModalProps = Parameters<typeof CashMovementModal>[0];

function renderModal(overrides: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    loading: false,
    open: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(async () => true),
    ...overrides,
  };
  const view = render(<CashMovementModal {...props} />);
  return { ...view, props };
}

const form = () => document.getElementById("cash-movement-form") as HTMLFormElement;
const fill = (amount: string, reason: string) => {
  fireEvent.change(screen.getByLabelText("Monto"), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: reason } });
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("CashMovementModal", () => {
  it("registra un ingreso y cierra el formulario solo cuando se confirma", async () => {
    const { props } = renderModal();
    fill("25.5", "  Fondo adicional ");

    fireEvent.submit(form());

    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(props.onSubmit).toHaveBeenCalledWith({ type: CashMovementType.in, amount: 25.5, reason: "Fondo adicional" });
  });

  it("registra un egreso con el tipo seleccionado", async () => {
    const { props } = renderModal();
    fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: CashMovementType.out } });
    fill("5", "Bolsas");

    fireEvent.submit(form());

    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(props.onSubmit).toHaveBeenCalledWith({ type: CashMovementType.out, amount: 5, reason: "Bolsas" });
  });

  it("un error de validacion no envia nada y conserva lo escrito", () => {
    const { props } = renderModal();
    fill("", "Bolsas");

    fireEvent.submit(form());

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/mayor que cero/)).toBeInTheDocument();
    expect(screen.getByLabelText("Motivo")).toHaveValue("Bolsas");
  });

  it("exige el motivo y no envia con un monto cero", () => {
    const { props } = renderModal();
    fill("0", "   ");

    fireEvent.submit(form());

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Ingresa el motivo del movimiento.")).toBeInTheDocument();
  });

  it("si el envio no se confirma el modal sigue abierto, conserva los datos y muestra el error", async () => {
    const onSubmit = vi.fn(async () => false);
    const view = renderModal({ onSubmit });
    fill("5", "Bolsas");

    fireEvent.submit(form());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    view.rerender(<CashMovementModal {...view.props} error="El monto excede el limite" onSubmit={onSubmit} />);

    expect(view.props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText("No se pudo registrar el movimiento")).toBeInTheDocument();
    expect(screen.getByText("El monto excede el limite")).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveValue(5);
    expect(screen.getByLabelText("Motivo")).toHaveValue("Bolsas");
  });

  it("un doble envio simultaneo (doble clic o Enter repetido) llama una sola vez", async () => {
    const pending = deferred<boolean>();
    const onSubmit = vi.fn(() => pending.promise);
    const { props } = renderModal({ onSubmit });
    fill("5", "Bolsas");

    fireEvent.submit(form());
    fireEvent.submit(form());
    fireEvent.submit(form());

    expect(onSubmit).toHaveBeenCalledOnce();
    pending.resolve(true);
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
  });

  it("tras un envio rechazado se puede volver a intentar (la barrera se libera)", async () => {
    const onSubmit = vi.fn(async () => false);
    renderModal({ onSubmit });
    fill("5", "Bolsas");

    fireEvent.submit(form());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.submit(form());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  it("muestra el estado de envio y deshabilita las acciones mientras carga", () => {
    renderModal({ loading: true });

    expect(screen.getByRole("button", { name: "Registrando..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });

  describe("resultado incierto", () => {
    const verification = { message: "No se pudo confirmar si el movimiento quedó registrado." };

    it("avisa la incertidumbre, conserva los datos y reemplaza el registro por la verificacion", () => {
      renderModal({ verification, error: "ignorado mientras exista la verificacion", onVerify: vi.fn(async () => false) });

      expect(screen.getByText("Resultado no confirmado")).toBeInTheDocument();
      expect(screen.getByText(verification.message)).toBeInTheDocument();
      expect(screen.queryByText("No se pudo registrar el movimiento")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Registrar movimiento" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Verificar de nuevo" })).toBeInTheDocument();
    });

    it("no permite enviar de nuevo ni siquiera con Enter mientras el resultado esta sin resolver", () => {
      const { props } = renderModal({ verification, onVerify: vi.fn(async () => false) });
      fill("5", "Bolsas");

      fireEvent.submit(form());

      expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it("«Verificar de nuevo» solo consulta y cierra el modal si el movimiento quedo confirmado", async () => {
      const onVerify = vi.fn(async () => true);
      const { props } = renderModal({ verification, onVerify });

      fireEvent.click(screen.getByRole("button", { name: "Verificar de nuevo" }));

      await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
      expect(onVerify).toHaveBeenCalledOnce();
      expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it("si la verificacion no resuelve nada el modal sigue abierto", async () => {
      const onVerify = vi.fn(async () => false);
      const { props } = renderModal({ verification, onVerify });

      fireEvent.click(screen.getByRole("button", { name: "Verificar de nuevo" }));

      await waitFor(() => expect(onVerify).toHaveBeenCalledOnce());
      expect(props.onClose).not.toHaveBeenCalled();
      expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it("durante la verificacion muestra el estado y bloquea las acciones", () => {
      renderModal({ verification, verifying: true, onVerify: vi.fn(async () => false) });

      expect(screen.getByRole("button", { name: "Verificando..." })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    });
  });
});
