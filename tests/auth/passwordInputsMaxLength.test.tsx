import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CUSTOMER_PASSWORD_POLICY, EMPLOYEE_PASSWORD_POLICY } from "@/config/auth-policy";
import { UserType } from "@/core/enums";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({ useOptionalStorefrontRoutes: () => null }));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({ useOptionalPublicTenant: () => null }));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = { auth: { resendEmailVerification: vi.fn() } };
  return { useRepositories: () => repositories };
});
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

import { LoginPage } from "@/modules/auth/pages/LoginPage";
import { TwoFactorAuthSection } from "@/shared/components/TwoFactorAuthSection";

const MAX = 24;

/** Todas las pantallas con campos de contraseña de la cuenta (login, registro, seguridad, etc.). */
const PASSWORD_SCREENS = [
  "src/modules/auth/pages/LoginPage.tsx",
  "src/modules/auth/pages/RegisterPage.tsx",
  "src/modules/auth/pages/ResetPasswordPage.tsx",
  "src/modules/auth/pages/ActivateAccountPage.tsx",
  "src/modules/auth/pages/EmployeeSeguridadPage.tsx",
  "src/modules/customer/pages/SeguridadPage.tsx",
  "src/shared/components/TwoFactorAuthSection/index.tsx",
];

describe("campos de contraseña: limite estricto de 24 caracteres", () => {
  it("la politica de cliente y la de empleado tienen un maximo de 24, igual que el backend", () => {
    expect(CUSTOMER_PASSWORD_POLICY.MAX_LENGTH).toBe(MAX);
    expect(EMPLOYEE_PASSWORD_POLICY.MAX_LENGTH).toBe(MAX);
  });

  it.each(PASSWORD_SCREENS)("cada <PasswordInput> de %s tiene maxLength", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const inputs = source.match(/<PasswordInput\b[\s\S]*?\/>/g) ?? [];

    expect(inputs.length).toBeGreaterThan(0);
    const withoutMaxLength = inputs.filter((input) => !/\bmaxLength=\{/.test(input));
    expect(withoutMaxLength).toEqual([]);
  });

  it.each([UserType.employee, UserType.customer])("el login (%s) no deja escribir mas de 24", (userType) => {
    render(<LoginPage expectedUserType={userType} />);

    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("maxLength", String(MAX));
  });

  it("el campo 'Contraseña actual' para desactivar MFA respeta el limite que le pasa la pagina", () => {
    render(
      <TwoFactorAuthSection
        busy={false}
        loading={false}
        onBegin={vi.fn()}
        onDisable={vi.fn()}
        onVerify={vi.fn()}
        passwordMaxLength={EMPLOYEE_PASSWORD_POLICY.MAX_LENGTH}
        status={{ enabled: true, method: "totp" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(screen.getByLabelText("Contraseña actual")).toHaveAttribute("maxLength", String(MAX));
  });
});
