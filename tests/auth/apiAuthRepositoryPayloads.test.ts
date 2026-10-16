import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

import { POST as activateEmployee } from "@/app/api/auth/activate-employee/route";
import { POST as emailResend } from "@/app/api/auth/email/resend/route";
import { POST as google } from "@/app/api/auth/google/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as mfaStatus } from "@/app/api/auth/mfa/route";
import { POST as mfaCode } from "@/app/api/auth/mfa/code/route";
import { POST as mfaDisable } from "@/app/api/auth/mfa/disable/route";
import { POST as mfaEnrollment } from "@/app/api/auth/mfa/enrollment/route";
import { POST as mfaEnrollmentVerify } from "@/app/api/auth/mfa/enrollment/verify/route";
import { POST as mfaResend } from "@/app/api/auth/mfa/resend/route";
import { POST as mfaVerify } from "@/app/api/auth/mfa/verify/route";
import { POST as passwordChange } from "@/app/api/auth/password/change/route";
import { POST as passwordForgot } from "@/app/api/auth/password/forgot/route";
import { POST as passwordReset } from "@/app/api/auth/password/reset/route";
import { POST as register } from "@/app/api/auth/register/route";
import { PATCH as sessionBranch } from "@/app/api/auth/session/branch/route";
import { POST as verifyEmail } from "@/app/api/auth/verify-email/route";
import type { TenantRepository } from "@/core/repositories";
import { UserType } from "@/core/enums";
import { ApiAuthRepository } from "@/infrastructure/api/ApiAuthRepository";
import { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";

/**
 * Cada metodo de ApiAuthRepository (el cliente real de la UI) contra su Route Handler real: el
 * `fetch` del navegador se despacha al handler con el Origin propio, y el `fetch` del handler hacia
 * el backend se registra. Confirma que el cuerpo EXACTO que manda la UI pasa los esquemas
 * `strictObject` y que al backend llega solo ese cuerpo.
 */

const ORIGIN = "http://localhost";
const BACKEND = "http://backend.internal/api/v1";
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

type Handler = (request: Request) => Promise<Response>;
const ROUTES: Record<string, Handler> = {
  "/api/auth/login": login,
  "/api/auth/google": google,
  "/api/auth/logout": logout,
  "/api/auth/mfa": mfaStatus as unknown as Handler,
  "/api/auth/mfa/verify": mfaVerify,
  "/api/auth/mfa/resend": mfaResend,
  "/api/auth/mfa/code": mfaCode,
  "/api/auth/mfa/disable": mfaDisable,
  "/api/auth/mfa/enrollment": mfaEnrollment,
  "/api/auth/mfa/enrollment/verify": mfaEnrollmentVerify,
  "/api/auth/password/change": passwordChange,
  "/api/auth/password/forgot": passwordForgot,
  "/api/auth/password/reset": passwordReset,
  "/api/auth/register": register,
  "/api/auth/verify-email": verifyEmail,
  "/api/auth/activate-employee": activateEmployee,
  "/api/auth/session/branch": sessionBranch,
  "/api/auth/email/resend": emailResend,
};

function currentSession(type: "employee" | "customer") {
  const now = new Date().toISOString();
  return {
    user: {
      id: "user-1",
      name: "Ana",
      email: "ana@tienda.test",
      phone: null,
      type,
      status: "active",
      tenantId: "tenant-1",
      customerId: type === "customer" ? "customer-1" : null,
      employeeCode: null,
      roleId: "role-1",
      branchId: null,
      allowedBranchIds: [],
      createdAt: now,
      updatedAt: now,
    },
    role: null,
    tenant: {
      id: "tenant-1",
      name: "Tienda",
      slug: "ferrepharma-demo",
      legalName: null,
      status: "active",
      defaultCurrency: "GTQ",
      timezone: "America/Guatemala",
      createdAt: now,
      updatedAt: now,
    },
    session: { id: "session-1", expiresAt: FUTURE, rememberMe: false, activeBranchId: null, createdAt: now, deviceLabel: null },
  };
}

let backendCalls: Array<{ path: string; method: string; body: unknown }>;
let backendReplies: Record<string, () => Response>;
let browserResponses: Response[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(BACKEND)) {
    const path = url.slice(BACKEND.length);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    backendCalls.push({ path, method: init?.method ?? "GET", body });
    return backendReplies[path]?.() ?? new Response(null, { status: 204 });
  }
  const handler = ROUTES[url];
  if (!handler) throw new Error(`Ruta inesperada: ${url}`);
  // El navegador agrega Origin en las peticiones same-origin que modifican.
  const headers = new Headers(init?.headers);
  headers.set("Origin", ORIGIN);
  const response = await handler(new Request(`${ORIGIN}${url}`, { ...init, headers }));
  browserResponses.push(response.clone());
  return response;
}

const tenants = {
  getById: async (id: string) => (id === "tenant-1" ? { slug: "ferrepharma-demo" } : null),
} as unknown as TenantRepository;

function createRepository() {
  return new ApiAuthRepository(new CurrentSessionClient(), tenants, new DataEventBus());
}

function lastBackendCall() {
  return backendCalls.at(-1);
}

beforeEach(() => {
  backendCalls = [];
  backendReplies = {};
  browserResponses = [];
  cookieStore.get.mockReturnValue({ value: "jwt" });
  vi.stubEnv("OMNIRETAIL_API_URL", BACKEND);
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
  vi.stubGlobal("fetch", vi.fn(browserFetch));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Ningun payload de la UI puede ser rechazado por Origin, Content-Type o esquema.
  for (const response of browserResponses) {
    expect([400, 403, 415]).not.toContain(response.status);
  }
});

describe("payload real de ApiAuthRepository contra cada Route Handler", () => {
  it("login de personal (sin tienda) llega tal cual al backend", async () => {
    backendReplies["/auth/login"] = () => json({ token: "jwt", expiresAt: FUTURE });
    backendReplies["/auth/me"] = () => json(currentSession("employee"));

    const result = await createRepository().login({
      email: "ana@tienda.test",
      passwordMock: "Secreta123!",
      rememberMe: false,
      expectedUserType: UserType.employee,
    });

    expect(result.status).toBe("authenticated");
    expect(backendCalls[0]).toEqual({
      path: "/auth/login",
      method: "POST",
      body: { email: "ana@tienda.test", password: "Secreta123!", rememberMe: false, expectedUserType: "employee" },
    });
    expect(cookieStore.set).toHaveBeenCalledWith("omniretail_session", "jwt", expect.objectContaining({ httpOnly: true }));
  });

  it("login de la tienda incluye tenantSlug y deviceLabel", async () => {
    backendReplies["/auth/login"] = () => json({ token: "jwt", expiresAt: FUTURE });
    backendReplies["/auth/me"] = () => json(currentSession("customer"));

    await createRepository().login({
      tenantId: "tenant-1",
      email: "ana@tienda.test",
      passwordMock: "Secreta123!",
      rememberMe: true,
      deviceLabel: "Chrome",
      expectedUserType: UserType.customer,
    });

    expect(backendCalls[0].body).toEqual({
      email: "ana@tienda.test",
      password: "Secreta123!",
      rememberMe: true,
      deviceLabel: "Chrome",
      tenantSlug: "ferrepharma-demo",
      expectedUserType: "customer",
    });
  });

  it("login con MFA responde el desafio sin cookie", async () => {
    backendReplies["/auth/login"] = () =>
      json({ mfaRequired: true, challengeToken: "challenge-1", method: "totp", expiresAt: FUTURE });

    const result = await createRepository().login({
      email: "ana@tienda.test",
      passwordMock: "Secreta123!",
      rememberMe: false,
      expectedUserType: UserType.employee,
    });

    expect(result).toEqual({ status: "mfa_required", challengeId: "challenge-1", method: "totp" });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("Continuar con Google", async () => {
    backendReplies["/auth/google"] = () => json({ token: "jwt", expiresAt: FUTURE });
    backendReplies["/auth/me"] = () => json(currentSession("customer"));

    await createRepository().loginWithGoogle({ idToken: "google-id-token", tenantSlug: "ferrepharma-demo", rememberMe: true });

    expect(backendCalls[0]).toEqual({
      path: "/auth/google",
      method: "POST",
      body: { idToken: "google-id-token", tenantSlug: "ferrepharma-demo", expectedUserType: "customer", rememberMe: true },
    });
  });

  it("segundo paso de MFA y reenvio del codigo", async () => {
    backendReplies["/auth/mfa/verify"] = () => json({ token: "jwt", expiresAt: FUTURE });
    backendReplies["/auth/me"] = () => json(currentSession("employee"));
    backendReplies["/auth/mfa/resend"] = () => new Response(null, { status: 204 });
    const repository = createRepository();

    await repository.verifyMfaChallenge("challenge-1", "123456");
    expect(backendCalls[0]).toEqual({ path: "/auth/mfa/verify", method: "POST", body: { challengeToken: "challenge-1", code: "123456" } });

    await repository.resendMfaChallengeCode("challenge-1");
    expect(lastBackendCall()).toEqual({ path: "/auth/mfa/resend", method: "POST", body: { challengeToken: "challenge-1" } });
  });

  it("logout (sin cuerpo) revoca y borra la cookie", async () => {
    await createRepository().logout("session-1");

    expect(lastBackendCall()).toEqual({ path: "/auth/logout", method: "POST", body: undefined });
    expect(cookieStore.delete).toHaveBeenCalledWith("omniretail_session");
  });

  it("sucursal activa", async () => {
    backendReplies["/auth/session/branch"] = () => json(currentSession("employee"));

    await createRepository().setActiveBranchId("branch-1");

    expect(lastBackendCall()).toEqual({ path: "/auth/session/branch", method: "PATCH", body: { branchId: "branch-1" } });
  });

  it("registro: el slug va en la ruta y el resultado no trae id", async () => {
    // Aunque el backend viejo devolviera 201 con id, la UI no lo lee.
    backendReplies["/public/ferrepharma-demo/auth/register"] = () =>
      json({ user: { id: "user-9", name: "Ana", email: "ana@tienda.test", type: "customer" } }, 201);

    const result = await createRepository().registerCustomer({
      tenantSlug: "ferrepharma-demo",
      name: "Ana",
      email: "ana@tienda.test",
      phone: "55551234",
      passwordMock: "Secreta123!",
    });

    expect(lastBackendCall()).toEqual({
      path: "/public/ferrepharma-demo/auth/register",
      method: "POST",
      body: { name: "Ana", email: "ana@tienda.test", phone: "55551234", password: "Secreta123!" },
    });
    expect(result).toEqual({
      user: { name: "Ana", email: "ana@tienda.test", type: UserType.customer },
      emailVerificationToken: null,
    });
    expect(result.user).not.toHaveProperty("id");
  });

  it("registro sin telefono (campo opcional omitido)", async () => {
    backendReplies["/public/ferrepharma-demo/auth/register"] = () =>
      json({ message: "Si el correo es válido, te enviamos un mensaje para continuar.", user: { name: "Ana", email: "ana@tienda.test", type: "customer" } }, 202);

    await createRepository().registerCustomer({
      tenantSlug: "ferrepharma-demo",
      name: "Ana",
      email: "ana@tienda.test",
      passwordMock: "Secreta123!",
    });

    expect(lastBackendCall()?.body).toEqual({ name: "Ana", email: "ana@tienda.test", password: "Secreta123!" });
  });

  it("verificacion de correo, recuperacion y restablecimiento", async () => {
    backendReplies["/auth/email/verify"] = () => json({ tenantSlug: "ferrepharma-demo" });
    backendReplies["/auth/password/forgot"] = () => json({ message: "ok" }, 202);
    backendReplies["/auth/password/reset"] = () => json({ userType: "customer", tenantSlug: "ferrepharma-demo" });
    const repository = createRepository();

    await expect(repository.verifyEmail("token-1")).resolves.toEqual({ tenantSlug: "ferrepharma-demo" });
    expect(lastBackendCall()?.body).toEqual({ token: "token-1" });

    await repository.requestPasswordReset({ email: "ana@tienda.test", tenantId: "tenant-1" });
    expect(lastBackendCall()).toEqual({
      path: "/auth/password/forgot",
      method: "POST",
      body: { email: "ana@tienda.test", tenantSlug: "ferrepharma-demo" },
    });

    await repository.requestPasswordReset({ email: "ana@tienda.test" });
    expect(lastBackendCall()?.body).toEqual({ email: "ana@tienda.test" });

    await repository.resetPassword("token-2", "NuevaSecreta1!");
    expect(lastBackendCall()).toEqual({
      path: "/auth/password/reset",
      method: "POST",
      body: { token: "token-2", newPassword: "NuevaSecreta1!" },
    });
  });

  it("MFA de la cuenta: activar, confirmar, desactivar, codigo por correo y estado", async () => {
    backendReplies["/auth/mfa/enrollment"] = () => json({ method: "totp", secret: "S", otpauthUri: "otpauth://x" });
    backendReplies["/auth/mfa/enrollment/verify"] = () => json({ recoveryCodes: ["a"] });
    backendReplies["/auth/mfa"] = () => json({ enabled: true, method: "totp" });
    const repository = createRepository();

    await repository.beginMfaEnrollment("session-1", "totp");
    expect(lastBackendCall()).toEqual({ path: "/auth/mfa/enrollment", method: "POST", body: { method: "totp" } });

    await repository.beginMfaEnrollment("session-1", "email");
    expect(lastBackendCall()?.body).toEqual({ method: "email" });

    await repository.verifyMfaEnrollment("session-1", "123456");
    expect(lastBackendCall()?.body).toEqual({ code: "123456" });

    await repository.disableMfa("session-1", "Secreta123!");
    expect(lastBackendCall()).toEqual({ path: "/auth/mfa/disable", method: "POST", body: { currentPassword: "Secreta123!" } });

    await repository.requestMfaActionCode();
    expect(lastBackendCall()).toEqual({ path: "/auth/mfa/code", method: "POST", body: undefined });

    await expect(repository.getMfaStatus()).resolves.toEqual({ enabled: true, method: "totp" });
  });

  it("activacion de empleado (exito sin cuerpo) y cambio de contraseña con y sin codigo", async () => {
    const repository = createRepository();

    await repository.activateEmployeeAccount("invite-1", "NuevaSecreta12!");
    expect(lastBackendCall()).toEqual({
      path: "/auth/activate-employee",
      method: "POST",
      body: { token: "invite-1", newPassword: "NuevaSecreta12!" },
    });

    await repository.changePassword({ sessionId: "session-1", currentPasswordMock: "Vieja1!", newPasswordMock: "Nueva1!x" });
    expect(lastBackendCall()).toEqual({
      path: "/auth/password/change",
      method: "POST",
      body: { currentPassword: "Vieja1!", newPassword: "Nueva1!x" },
    });

    await repository.changePassword({
      sessionId: "session-1",
      currentPasswordMock: "Vieja1!",
      newPasswordMock: "Nueva1!x",
      mfaCodeMock: " 123456 ",
    });
    expect(lastBackendCall()?.body).toEqual({ currentPassword: "Vieja1!", newPassword: "Nueva1!x", mfaCode: "123456" });
  });

  it("reenvio de la verificacion: correo normalizado y nunca lanza", async () => {
    backendReplies["/auth/email/resend"] = () => json({ message: "Si el correo es válido, te enviamos un mensaje para continuar." }, 202);

    await createRepository().resendEmailVerification({ email: "  Ana@Tienda.TEST ", tenantSlug: "ferrepharma-demo" });

    expect(lastBackendCall()).toEqual({
      path: "/auth/email/resend",
      method: "POST",
      body: { email: "ana@tienda.test", tenantSlug: "ferrepharma-demo" },
    });
  });
});
