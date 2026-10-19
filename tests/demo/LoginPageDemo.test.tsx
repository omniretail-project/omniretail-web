import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserType } from "@/core/enums";

const submit = vi.fn();

vi.mock("@/modules/auth/hooks/useLogin", () => ({
  useLogin: () => ({
    email: "",
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
    submit,
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
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({
  useOptionalStorefrontRoutes: () => null,
}));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { LoginPage } from "@/modules/auth/pages/LoginPage";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LoginPage demo quick access", () => {
  it("does not render quick logins nor hides password recovery without the flag", () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
    render(<LoginPage expectedUserType={UserType.employee} />);
    expect(screen.queryByText(/Entrar como/)).not.toBeInTheDocument();
    expect(screen.getByText("¿Olvidaste tu contraseña?")).toBeInTheDocument();
  });

  it("renders the three quick logins in the demo and submits the demo credentials", () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    render(<LoginPage expectedUserType={UserType.employee} />);
    expect(screen.getByText("Entrar como Administrador")).toBeInTheDocument();
    expect(screen.getByText("Entrar como Cajero")).toBeInTheDocument();
    expect(screen.getByText("Entrar como Bodega")).toBeInTheDocument();
    expect(screen.queryByText("¿Olvidaste tu contraseña?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Entrar como Cajero"));
    expect(submit).toHaveBeenCalledWith({
      email: "cajero@marjym.demo",
      password: "CajeroDemo123",
    });
  });

  it("does not render quick logins for the customer login even in the demo", () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    render(<LoginPage expectedUserType={UserType.customer} />);
    expect(screen.queryByText(/Entrar como/)).not.toBeInTheDocument();
  });
});
