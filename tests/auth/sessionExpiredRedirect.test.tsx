import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserType } from "@/core/enums";

const state = vi.hoisted(() => ({
  snapshot: { sessionId: null as string | null, user: null as unknown, role: null as unknown },
  clearLocalSession: vi.fn(),
  searchParams: new URLSearchParams(),
  formError: undefined as string | undefined,
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = { auth: { clearLocalSession: state.clearLocalSession } };
  return { useRepositories: () => repositories };
});
vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));
vi.mock("@/modules/auth/application/services/resolveCurrentSessionSnapshot", () => ({
  resolveCurrentSessionSnapshot: async () => state.snapshot,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => state.searchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({
  useOptionalStorefrontRoutes: () => null,
}));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  useOptionalPublicTenant: () => null,
}));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/modules/auth/hooks/useLogin", () => ({
  useLogin: () => ({
    email: "",
    setEmail: vi.fn(),
    password: "",
    setPassword: vi.fn(),
    rememberMe: false,
    setRememberMe: vi.fn(),
    fieldErrors: {},
    formError: state.formError,
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

import { notifySessionExpired } from "@/infrastructure/api/sessionExpiredSignal";
import { LoginPage } from "@/modules/auth/pages/LoginPage";
import { CurrentSessionProvider, useCurrentSessionContext } from "@/modules/auth/providers/CurrentSessionProvider";

const SESSION_EXPIRED_NOTICE = "Tu sesión expiró. Inicia sesión de nuevo.";
const replace = vi.fn();
const originalLocation = window.location;

function setPathname(pathname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, pathname, replace },
  });
}

function SessionProbe() {
  const { user, loading } = useCurrentSessionContext();
  return <p>{loading ? "cargando" : user ? "con-sesion" : "sin-sesion"}</p>;
}

async function renderProvider() {
  render(
    <CurrentSessionProvider>
      <SessionProbe />
    </CurrentSessionProvider>,
  );
  await screen.findByText(state.snapshot.user ? "con-sesion" : "sin-sesion");
}

beforeEach(() => {
  state.snapshot = {
    sessionId: "session-1",
    user: { id: "user-1", type: UserType.employee, roleId: "role-1" },
    role: { id: "role-1", permissions: [] },
  };
  state.clearLocalSession.mockReset();
  state.clearLocalSession.mockResolvedValue(undefined);
  state.searchParams = new URLSearchParams();
  state.formError = undefined;
  replace.mockReset();
  setPathname("/inicio");
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("CurrentSessionProvider ante un 401 a mitad de uso", () => {
  it("limpia la sesion local una sola vez aunque fallen varias peticiones a la vez", async () => {
    await renderProvider();

    notifySessionExpired();
    notifySessionExpired();
    notifySessionExpired();

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(state.clearLocalSession).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/iniciar-sesion?sesion=expirada");
  });

  it("redirige despues de limpiar la sesion local", async () => {
    let finishClear: () => void = () => undefined;
    state.clearLocalSession.mockReturnValue(new Promise<void>((resolve) => (finishClear = resolve)));
    await renderProvider();

    notifySessionExpired();
    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();

    finishClear();
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it("redirige igual si limpiar la sesion local falla", async () => {
    state.clearLocalSession.mockRejectedValue(new Error("sin red"));
    await renderProvider();

    notifySessionExpired();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/iniciar-sesion?sesion=expirada"));
  });

  it("un cliente vuelve al login de su tienda", async () => {
    state.snapshot.user = { id: "user-2", type: UserType.customer };
    setPathname("/tienda/ferrepharma-demo/cuenta");
    await renderProvider();

    notifySessionExpired();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/tienda/ferrepharma-demo/iniciar-sesion?sesion=expirada"),
    );
  });

  it("sin usuario (visitante o pantalla de login) no hace nada", async () => {
    state.snapshot = { sessionId: null, user: null, role: null };
    await renderProvider();

    notifySessionExpired();
    await Promise.resolve();

    expect(state.clearLocalSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("LoginPage con ?sesion=expirada", () => {
  it("muestra el aviso de sesion expirada", () => {
    state.searchParams = new URLSearchParams("sesion=expirada");
    render(<LoginPage expectedUserType={UserType.employee} />);

    expect(screen.getByText(SESSION_EXPIRED_NOTICE)).toBeInTheDocument();
  });

  it("sin el parametro no muestra el aviso", () => {
    render(<LoginPage expectedUserType={UserType.employee} />);

    expect(screen.queryByText(SESSION_EXPIRED_NOTICE)).not.toBeInTheDocument();
  });

  it("el error del formulario tiene prioridad sobre el aviso", () => {
    state.searchParams = new URLSearchParams("sesion=expirada");
    state.formError = "Credenciales inválidas.";
    render(<LoginPage expectedUserType={UserType.employee} />);

    expect(screen.getByText("Credenciales inválidas.")).toBeInTheDocument();
    expect(screen.queryByText(SESSION_EXPIRED_NOTICE)).not.toBeInTheDocument();
  });
});
