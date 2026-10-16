import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENERIC_ACCOUNT_EMAIL_MESSAGE } from "@/config/auth-policy";
import { UserType } from "@/core/enums";

const resendEmailVerification = vi.fn();
const registerCustomer = vi.fn();
let tenantSlug: string | undefined = "ferrepharma-demo";

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({ auth: { resendEmailVerification, registerCustomer } }),
}));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  useOptionalPublicTenant: () => ({ tenantSlug, loading: false, error: undefined, tenantId: "tenant-1" }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({
  useOptionalStorefrontRoutes: () => null,
}));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const loginState = { email: "ana@tienda.test" };
vi.mock("@/modules/auth/hooks/useLogin", () => ({
  useLogin: () => ({
    email: loginState.email,
    setEmail: vi.fn(),
    password: "",
    setPassword: vi.fn(),
    rememberMe: false,
    setRememberMe: vi.fn(),
    fieldErrors: {},
    formError: undefined,
    isSubmitting: false,
    tenantLoading: false,
    tooManyAttempts: false,
    submit: vi.fn(),
    loginWithGoogle: vi.fn(),
    pendingChallenge: null,
    mfaCode: "",
    setMfaCode: vi.fn(),
    submitMfaChallenge: vi.fn(),
    resendMfaCode: vi.fn(),
    resendCooldownSeconds: 0,
    cancelMfaChallenge: vi.fn(),
  }),
}));

import { ResendVerificationPrompt } from "@/modules/auth/components/ResendVerificationPrompt";
import { LoginPage } from "@/modules/auth/pages/LoginPage";
import { RegisterPage } from "@/modules/auth/pages/RegisterPage";

beforeEach(() => {
  tenantSlug = "ferrepharma-demo";
  resendEmailVerification.mockResolvedValue(undefined);
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "api");
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ResendVerificationPrompt (pantalla 'Revisa tu correo')", () => {
  it("reenvia con el correo registrado, muestra el mensaje generico y espera 30 s", async () => {
    render(<ResendVerificationPrompt email="ana@tienda.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    await waitFor(() => expect(screen.getByText(GENERIC_ACCOUNT_EMAIL_MESSAGE)).toBeInTheDocument());
    expect(resendEmailVerification).toHaveBeenCalledWith({ email: "ana@tienda.test", tenantSlug: "ferrepharma-demo" });
    const button = screen.getByRole("button", { name: /Reenviar \(30 s\)/ });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(resendEmailVerification).toHaveBeenCalledTimes(1);
  });

  it("vuelve a habilitarse cuando termina la espera", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      render(<ResendVerificationPrompt email="ana@tienda.test" />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));
      });
      expect(screen.getByRole("button", { name: /\(30 s\)/ })).toBeDisabled();

      await act(async () => {
        vi.advanceTimersByTime(31_000);
      });
      expect(screen.getByRole("button", { name: "Reenviar" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin tienda resuelta no llama al repositorio pero responde igual", async () => {
    tenantSlug = undefined;
    render(<ResendVerificationPrompt email="ana@tienda.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    await waitFor(() => expect(screen.getByText(GENERIC_ACCOUNT_EMAIL_MESSAGE)).toBeInTheDocument());
    expect(resendEmailVerification).not.toHaveBeenCalled();
  });
});

describe("ResendVerificationPrompt en linea (login de la tienda)", () => {
  it("abre el mini formulario con el correo precargado y valida el formato", async () => {
    render(<ResendVerificationPrompt editable email="ana@tienda.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    const input = screen.getByLabelText("Correo de tu cuenta");
    expect(input).toHaveValue("ana@tienda.test");

    fireEvent.change(input, { target: { value: "no-es-correo" } });
    fireEvent.click(screen.getByRole("button", { name: "Reenviar correo" }));
    expect(await screen.findByText("Ingrese un correo con formato válido.")).toBeInTheDocument();
    expect(resendEmailVerification).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "otra@tienda.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Reenviar correo" }));
    await waitFor(() => expect(screen.getByText(GENERIC_ACCOUNT_EMAIL_MESSAGE)).toBeInTheDocument());
    expect(resendEmailVerification).toHaveBeenCalledWith({ email: "otra@tienda.test", tenantSlug: "ferrepharma-demo" });
    expect(screen.getByRole("button", { name: /Reenviar correo \(30 s\)/ })).toBeDisabled();
  });
});

describe("LoginPage", () => {
  it("muestra el reenvio solo en el login de clientes", () => {
    const { unmount } = render(<LoginPage expectedUserType={UserType.customer} />);
    expect(screen.getByText(/No te llegó el correo de verificación/)).toBeInTheDocument();
    unmount();

    render(<LoginPage expectedUserType={UserType.employee} />);
    expect(screen.queryByText(/No te llegó el correo de verificación/)).not.toBeInTheDocument();
  });

  it("no lo muestra en la demo publica", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    render(<LoginPage expectedUserType={UserType.customer} />);
    expect(screen.queryByText(/No te llegó el correo de verificación/)).not.toBeInTheDocument();
  });
});

describe("RegisterPage: mensaje generico", () => {
  it("despues del registro no dice 'Creamos tu cuenta' y ofrece reenviar", async () => {
    registerCustomer.mockResolvedValue({
      user: { name: "Ana", email: "ana@tienda.test", type: UserType.customer },
      emailVerificationToken: null,
    });
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/Nombre/), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(/Correo/), { target: { value: "ana@tienda.test" } });
    const passwords = screen.getAllByLabelText(/contraseña/i);
    fireEvent.change(passwords[0], { target: { value: "Secreta123!" } });
    fireEvent.change(passwords[1], { target: { value: "Secreta123!" } });
    fireEvent.click(screen.getByRole("button", { name: /Crear cuenta|Registr/i }));

    expect(await screen.findByText("Revisa tu correo")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(GENERIC_ACCOUNT_EMAIL_MESSAGE))).toBeInTheDocument();
    expect(screen.queryByText(/Creamos tu cuenta/)).not.toBeInTheDocument();
    expect(screen.getByText(/No te llegó el correo\?/)).toBeInTheDocument();
  });
});
