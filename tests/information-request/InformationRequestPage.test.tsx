import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  submit: vi.fn(),
}));

vi.mock("@/modules/information-request/hooks/useInformationRequest", () => ({
  useInformationRequest: () => state.current,
}));

import { InformationRequestPage } from "@/modules/information-request/pages/InformationRequestPage";

const REQUEST_ID = "7d444840-9dc0-41d3-8a59-6a8a6c0f1e11";

function base(overrides: Record<string, unknown> = {}) {
  return {
    values: {
      fullName: "",
      businessName: "",
      email: "",
      phone: "",
      industry: "",
      modules: [],
      message: "",
      consentAccepted: false,
      website: "",
      captchaToken: "",
    },
    fieldErrors: {},
    status: "idle",
    message: null,
    requestId: null,
    captchaNonce: 0,
    isSubmitting: false,
    setField: vi.fn(),
    toggleModule: vi.fn(),
    submit: state.submit,
    reset: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  state.submit.mockReset();
  state.current = base();
});

describe("InformationRequestPage", () => {
  it("renderiza campos etiquetados y consentimiento, sin credenciales ni CTA de contratacion", () => {
    render(<InformationRequestPage />);
    for (const label of [
      /Nombre completo/,
      /Nombre comercial/,
      /Correo electrónico/,
      /Teléfono/,
      /Rubro comercial/,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(
      screen.getByRole("checkbox", { name: /Acepto que MARJYM use estos datos/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Módulos de interés/ })).toHaveAttribute(
      "aria-required",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "Reportes avanzados" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solicitar información" })).toBeEnabled();
    expect(screen.queryByText(/contratar/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  });

  it("limita los campos y usa una cuadrícula compacta de dos columnas solo desde escritorio", () => {
    render(<InformationRequestPage />);
    const fullName = screen.getByLabelText(/Nombre completo/);
    const businessName = screen.getByLabelText(/Nombre comercial/);
    const email = screen.getByLabelText(/Correo electrónico/);
    const phone = screen.getByLabelText(/Teléfono/);
    const message = screen.getByLabelText(/Comentarios adicionales/);

    expect(fullName).toHaveAttribute("maxlength", "100");
    expect(businessName).toHaveAttribute("maxlength", "120");
    expect(email).toHaveAttribute("maxlength", "254");
    expect(phone).toHaveAttribute("maxlength", "20");
    expect(message).toHaveAttribute("maxlength", "1000");
    expect(fullName).toHaveClass("h-11");

    const grid = fullName.closest("div.grid");
    expect(grid).toHaveClass("md:grid-cols-2", "gap-y-4", "gap-x-5");
    expect(grid).not.toHaveClass("sm:grid-cols-2");
    expect(screen.getByRole("heading", { name: /Solicita información/ }).closest("section"))
      .toHaveClass("max-w-[720px]");
  });

  it("el honeypot esta oculto a tecnologias de asistencia y fuera de la tabulacion", () => {
    render(<InformationRequestPage />);
    const honeypot = document.getElementById("info-website") as HTMLInputElement;
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("envia el formulario con submit", () => {
    render(<InformationRequestPage />);
    const form = screen.getByRole("button", { name: "Solicitar información" }).closest("form");
    fireEvent.submit(form as HTMLFormElement);
    expect(state.submit).toHaveBeenCalledTimes(1);
  });

  it("deshabilita el boton y marca aria-busy mientras envia", () => {
    state.current = base({ status: "submitting", isSubmitting: true });
    render(<InformationRequestPage />);
    const button = screen.getByRole("button", { name: "Enviando solicitud..." });
    expect(button).toBeDisabled();
    expect(button.closest("form")).toHaveAttribute("aria-busy", "true");
  });

  it("asocia los errores a sus campos", () => {
    state.current = base({ fieldErrors: { email: "Ingresa un correo electrónico válido." } });
    render(<InformationRequestPage />);
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveClass(
      "aria-invalid:border-[var(--color-danger)]",
    );
    expect(screen.getByText("Ingresa un correo electrónico válido.")).toBeInTheDocument();
  });

  it("muestra aviso incierto sin mensaje de exito y permite reintentar", () => {
    state.current = base({
      status: "uncertain",
      message: "No pudimos confirmar si recibimos tu solicitud.",
    });
    render(<InformationRequestPage />);
    expect(screen.getByText(/No pudimos confirmar/)).toBeInTheDocument();
    expect(screen.queryByText("Hemos recibido tu solicitud")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar envío" })).toBeEnabled();
  });

  it("muestra exito con numero de solicitud y sin afirmar el envio de correo", () => {
    state.current = base({ status: "received", requestId: REQUEST_ID });
    render(<InformationRequestPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Hemos recibido tu solicitud");
    expect(screen.getByText(REQUEST_ID)).toBeInTheDocument();
    expect(screen.queryByText(/te enviamos un correo|correo de confirmación/i)).not.toBeInTheDocument();
  });
});
