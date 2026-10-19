import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("Enviar otra solicitud reinicia el formulario y Volver al inicio enlaza a la landing", () => {
    state.current = base({ status: "received", requestId: REQUEST_ID });
    render(<InformationRequestPage />);

    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
    fireEvent.click(screen.getByRole("button", { name: "Enviar otra solicitud" }));

    expect(state.current.reset).toHaveBeenCalledTimes(1);
  });

  it("no muestra exito si el estado es received pero falta el numero de solicitud", () => {
    state.current = base({ status: "received", requestId: null });
    render(<InformationRequestPage />);
    expect(screen.queryByText("Hemos recibido tu solicitud")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solicitar información" })).toBeInTheDocument();
  });

  it("muestra el error general cuando el envio fallo", () => {
    state.current = base({ status: "failed", message: "El servicio no está disponible temporalmente." });
    render(<InformationRequestPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("El servicio no está disponible temporalmente.");
    expect(screen.queryByText("Hemos recibido tu solicitud")).not.toBeInTheDocument();
  });

  it("cada campo reporta su cambio al hook con el campo y el valor correctos", () => {
    render(<InformationRequestPage />);
    const setField = state.current.setField as ReturnType<typeof vi.fn>;

    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: "Ana Pérez" } });
    fireEvent.change(screen.getByLabelText(/Nombre comercial/), { target: { value: "Ferretería" } });
    fireEvent.change(screen.getByLabelText(/Correo electrónico/), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: "+502 1234 5678" } });
    fireEvent.change(screen.getByLabelText(/Rubro comercial/), { target: { value: "hardware" } });
    fireEvent.change(screen.getByLabelText(/Comentarios adicionales/), { target: { value: "Hola" } });
    fireEvent.change(document.getElementById("info-website") as HTMLInputElement, {
      target: { value: "bot" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Acepto que MARJYM use estos datos/ }));

    expect(setField.mock.calls).toEqual([
      ["fullName", "Ana Pérez"],
      ["businessName", "Ferretería"],
      ["email", "ana@example.com"],
      ["phone", "+502 1234 5678"],
      ["industry", "hardware"],
      ["message", "Hola"],
      ["website", "bot"],
      ["consentAccepted", true],
    ]);
  });

  it("marcar un modulo lo reporta con su codigo y el contador refleja el mensaje", () => {
    state.current = base({
      values: {
        ...(base().values as Record<string, unknown>),
        message: "abc",
        modules: ["pos"],
      },
    });
    render(<InformationRequestPage />);

    expect(screen.getByRole("checkbox", { name: "Punto de venta" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Compras" }));

    expect(state.current.toggleModule).toHaveBeenCalledWith("purchasing");
    expect(screen.getByText("3/1000")).toBeInTheDocument();
  });

  it("muestra los errores de consentimiento y de modulos asociados a sus controles", () => {
    state.current = base({
      fieldErrors: {
        consentAccepted: "Debes aceptar para que podamos responder tu solicitud.",
        modules: "Selecciona al menos un módulo.",
      },
    });
    render(<InformationRequestPage />);

    expect(screen.getByRole("checkbox", { name: /Acepto que MARJYM use estos datos/ })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("Debes aceptar para que podamos responder tu solicitud.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Módulos de interés/ })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Selecciona al menos un módulo.")).toBeInTheDocument();
  });
});

describe("InformationRequestPage con CAPTCHA configurado", () => {
  const turnstileRender = vi.fn<(element: HTMLElement, options: { callback: (token: string) => void }) => string>();

  beforeEach(() => {
    turnstileRender.mockReset();
    turnstileRender.mockReturnValue("widget-1");
    (globalThis as { turnstile?: unknown }).turnstile = { render: turnstileRender, remove: vi.fn() };
  });

  afterEach(() => {
    delete (globalThis as { turnstile?: unknown }).turnstile;
    vi.unstubAllEnvs();
  });

  it("sin clave del sitio no monta el CAPTCHA y pide al hook que no lo exija", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_CAPTCHA_SITE_KEY", "");
    render(<InformationRequestPage />);
    expect(turnstileRender).not.toHaveBeenCalled();
  });

  it("con clave monta el widget y entrega el token al campo captchaToken", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_CAPTCHA_SITE_KEY", "clave-publica");
    render(<InformationRequestPage />);

    await waitFor(() => expect(turnstileRender).toHaveBeenCalledTimes(1));
    turnstileRender.mock.calls[0][1].callback("token-turnstile");

    expect(state.current.setField).toHaveBeenCalledWith("captchaToken", "token-turnstile");
  });

  it("muestra el error cuando falta completar la verificacion", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_CAPTCHA_SITE_KEY", "clave-publica");
    state.current = base({ fieldErrors: { captchaToken: "Completa la verificación de seguridad." } });
    render(<InformationRequestPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Completa la verificación de seguridad.");
  });
});
