import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

import { forwardAuthBackendResponse, invalidCredentials, openSessionResponse } from "@/app/api/_lib/backend";
import { POST as activateEmployee } from "@/app/api/auth/activate-employee/route";
import { POST as emailResend } from "@/app/api/auth/email/resend/route";
import { POST as google } from "@/app/api/auth/google/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
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

const ORIGIN = "http://localhost";
const BACKEND = "http://backend.internal/api/v1";
const backendFetch = vi.fn();

type Handler = (request: Request) => Promise<Response>;

/** Todos los POST/PATCH con cuerpo JSON de /api/auth/**, con un cuerpo valido de ejemplo. */
const JSON_ROUTES: Array<{ path: string; method: "POST" | "PATCH"; handler: Handler; body: Record<string, unknown> }> = [
  { path: "/api/auth/login", method: "POST", handler: login, body: { email: "a@b.co", password: "x", expectedUserType: "employee" } },
  {
    path: "/api/auth/google",
    method: "POST",
    handler: google,
    body: { idToken: "t", tenantSlug: "tienda", expectedUserType: "customer", rememberMe: false },
  },
  { path: "/api/auth/mfa/verify", method: "POST", handler: mfaVerify, body: { challengeToken: "c", code: "123456" } },
  { path: "/api/auth/mfa/resend", method: "POST", handler: mfaResend, body: { challengeToken: "c" } },
  { path: "/api/auth/mfa/disable", method: "POST", handler: mfaDisable, body: { currentPassword: "x" } },
  { path: "/api/auth/mfa/enrollment", method: "POST", handler: mfaEnrollment, body: { method: "totp" } },
  { path: "/api/auth/mfa/enrollment/verify", method: "POST", handler: mfaEnrollmentVerify, body: { code: "123456" } },
  { path: "/api/auth/password/change", method: "POST", handler: passwordChange, body: { currentPassword: "x", newPassword: "y" } },
  { path: "/api/auth/password/forgot", method: "POST", handler: passwordForgot, body: { email: "a@b.co" } },
  { path: "/api/auth/password/reset", method: "POST", handler: passwordReset, body: { token: "t", newPassword: "y" } },
  {
    path: "/api/auth/register",
    method: "POST",
    handler: register,
    body: { tenantSlug: "tienda", name: "Ana", email: "a@b.co", password: "y" },
  },
  { path: "/api/auth/verify-email", method: "POST", handler: verifyEmail, body: { token: "t" } },
  { path: "/api/auth/activate-employee", method: "POST", handler: activateEmployee, body: { token: "t", newPassword: "y" } },
  { path: "/api/auth/session/branch", method: "PATCH", handler: sessionBranch, body: { branchId: "b" } },
  { path: "/api/auth/email/resend", method: "POST", handler: emailResend, body: { email: "a@b.co", tenantSlug: "tienda" } },
];

/** POST sin cuerpo: solo exigen Origin. */
const BODYLESS_ROUTES: Array<{ path: string; handler: Handler }> = [
  { path: "/api/auth/logout", handler: logout },
  { path: "/api/auth/mfa/code", handler: mfaCode },
];

function buildRequest(
  path: string,
  { method = "POST", origin = ORIGIN, contentType = "application/json", body }: {
    method?: string;
    origin?: string | null;
    contentType?: string | null;
    body?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (contentType) headers.set("Content-Type", contentType);
  return new Request(`${ORIGIN}${path}`, { method, headers, body });
}

beforeEach(() => {
  backendFetch.mockReset();
  backendFetch.mockResolvedValue(new Response(null, { status: 204 }));
  cookieStore.get.mockReturnValue({ value: "jwt" });
  vi.stubEnv("OMNIRETAIL_API_URL", BACKEND);
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
  vi.stubGlobal("fetch", backendFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(JSON_ROUTES)("$method $path", ({ path, method, handler, body }) => {
  it("Origin ajeno -> 403 sin llamar al backend", async () => {
    const response = await handler(buildRequest(path, { method, origin: "https://evil.example", body: JSON.stringify(body) }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("sin Origin -> 403", async () => {
    const response = await handler(buildRequest(path, { method, origin: null, body: JSON.stringify(body) }));
    expect(response.status).toBe(403);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("Content-Type text/plain -> 415 (formulario cross-site con enctype text/plain)", async () => {
    const response = await handler(buildRequest(path, { method, contentType: "text/plain", body: JSON.stringify(body) }));
    expect(response.status).toBe(415);
    expect((await response.json()).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("campo de mas -> 400 VALIDATION_ERROR sin llamar al backend", async () => {
    const response = await handler(buildRequest(path, { method, body: JSON.stringify({ ...body, role: "admin" }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("VALIDATION_ERROR");
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("JSON ilegible -> 400 REQUEST_ERROR sin llamar al backend", async () => {
    const response = await handler(buildRequest(path, { method, body: "{" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("REQUEST_ERROR");
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("cuerpo demasiado grande -> 400 sin llamar al backend", async () => {
    const response = await handler(buildRequest(path, { method, body: JSON.stringify({ ...body, padding: "x".repeat(20_000) }) }));
    expect(response.status).toBe(400);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("sin backend configurado -> 503 antes de cualquier otra comprobacion", async () => {
    vi.stubEnv("OMNIRETAIL_API_URL", "");
    const response = await handler(buildRequest(path, { method, origin: "https://evil.example", body: "{" }));
    expect(response.status).toBe(503);
    expect(backendFetch).not.toHaveBeenCalled();
  });
});

describe.each(BODYLESS_ROUTES)("POST $path (sin cuerpo)", ({ path, handler }) => {
  it("Origin ajeno -> 403 sin llamar al backend ni tocar la cookie", async () => {
    const response = await handler(buildRequest(path, { origin: "https://evil.example", contentType: null }));
    expect(response.status).toBe(403);
    expect(backendFetch).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("mismo Origin y sin Content-Type -> se acepta", async () => {
    const response = await handler(buildRequest(path, { contentType: null }));
    expect(response.status).toBe(204);
    expect(backendFetch).toHaveBeenCalledTimes(1);
  });
});

describe("validaciones especificas", () => {
  it("login exige expectedUserType", async () => {
    const response = await login(buildRequest("/api/auth/login", { body: JSON.stringify({ email: "a@b.co", password: "x" }) }));
    expect(response.status).toBe(400);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("Google solo acepta expectedUserType customer", async () => {
    const response = await google(
      buildRequest("/api/auth/google", {
        body: JSON.stringify({ idToken: "t", tenantSlug: "tienda", expectedUserType: "employee" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("registro rechaza un slug invalido sin llamar al backend", async () => {
    const response = await register(
      buildRequest("/api/auth/register", {
        body: JSON.stringify({ tenantSlug: "../admin", name: "Ana", email: "a@b.co", password: "y" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("Content-Type application/json con charset se acepta", async () => {
    const response = await verifyEmail(
      buildRequest("/api/auth/verify-email", { contentType: "application/json; charset=utf-8", body: JSON.stringify({ token: "t" }) }),
    );
    expect(response.status).toBe(204);
  });
});

describe("errores del backend hacia el navegador", () => {
  it("un 500 con traza llega como mensaje generico con el mismo status", async () => {
    backendFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ status: 500, trace: "java.lang.NullPointerException at com.omniretail...", path: "/api/v1/auth/password/forgot" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );
    const response = await passwordForgot(buildRequest("/api/auth/password/forgot", { body: JSON.stringify({ email: "a@b.co" }) }));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(text).not.toContain("NullPointer");
    expect(text).not.toContain("/api/v1");
  });

  it("un 503 HTML del proxy llega como SERVICE_UNAVAILABLE", async () => {
    backendFetch.mockResolvedValue(new Response("<html>nginx</html>", { status: 503 }));
    const response = await login(
      buildRequest("/api/auth/login", { body: JSON.stringify({ email: "a@b.co", password: "x", expectedUserType: "employee" }) }),
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("nginx");
  });

  it("un 4xx conserva code, message y fields y descarta path, trace y otros campos", async () => {
    backendFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 400,
          error: "Bad Request",
          code: "VALIDATION_ERROR",
          message: "La contraseña no cumple la política.",
          fields: { newPassword: "Debe tener 12 caracteres.", nested: { x: 1 } },
          path: "/api/v1/auth/password/reset",
          trace: "stack",
          exception: "org.springframework.Foo",
          timestamp: "2026-10-16T00:00:00Z",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    const response = await passwordReset(
      buildRequest("/api/auth/password/reset", { body: JSON.stringify({ token: "t", newPassword: "y" }) }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: 400,
      error: "Bad Request",
      code: "VALIDATION_ERROR",
      message: "La contraseña no cumple la política.",
      fields: { newPassword: "Debe tener 12 caracteres." },
      timestamp: "2026-10-16T00:00:00Z",
    });
  });

  it("un 401 sin cuerpo (Spring Security) se reenvia vacio", async () => {
    const response = await forwardAuthBackendResponse(new Response(null, { status: 401 }));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  it("un 4xx que no es JSON se reemplaza por un error generico", async () => {
    const response = await forwardAuthBackendResponse(new Response("<html>Whitelabel</html>", { status: 404 }));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("REQUEST_ERROR");
    expect(JSON.stringify(body)).not.toContain("Whitelabel");
  });

  it("los mensajes de negocio 4xx se conservan (429 de reenvio)", async () => {
    backendFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 429, code: "MFA_CODE_RESEND_LIMITED", message: "Espera un minuto." }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const response = await mfaResend(buildRequest("/api/auth/mfa/resend", { body: JSON.stringify({ challengeToken: "c" }) }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ status: 429, code: "MFA_CODE_RESEND_LIMITED", message: "Espera un minuto." });
  });

  it("invalidCredentials no expone la ruta interna del backend", async () => {
    const body = await invalidCredentials().json();
    expect(body.code).toBe("INVALID_CREDENTIALS");
    expect(body).not.toHaveProperty("path");
  });
});

describe("apertura de sesion", () => {
  it("un expiresAt invalido revoca el token y no crea la cookie", async () => {
    const response = await openSessionResponse("jwt", "no-es-fecha", "employee");
    expect(response.status).toBe(503);
    expect(backendFetch).toHaveBeenCalledWith(`${BACKEND}/auth/logout`, expect.objectContaining({ method: "POST" }));
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("un expiresAt vencido tampoco crea la cookie", async () => {
    const response = await openSessionResponse("jwt", "2000-01-01T00:00:00Z");
    expect(response.status).toBe(503);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("sin token no llama al backend", async () => {
    const response = await openSessionResponse(undefined, "2999-01-01T00:00:00Z");
    expect(response.status).toBe(503);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("un tipo de cuenta inesperado responde INVALID_CREDENTIALS y revoca", async () => {
    backendFetch.mockImplementation(async (url: string) =>
      url.endsWith("/auth/me")
        ? new Response(JSON.stringify({ user: { type: "customer" } }), { status: 200 })
        : new Response(null, { status: 204 }),
    );
    const response = await openSessionResponse("jwt", "2999-01-01T00:00:00Z", "employee");
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("INVALID_CREDENTIALS");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/me", () => {
  it("sin cookie responde 401 sin llamar al backend", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const response = await me();
    expect(response.status).toBe(401);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("un 401 del backend borra la cookie", async () => {
    backendFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const response = await me();
    expect(response.status).toBe(401);
    expect(cookieStore.delete).toHaveBeenCalledWith("omniretail_session");
  });

  it("un 500 del backend llega generico y no borra la cookie", async () => {
    backendFetch.mockResolvedValue(new Response("java.lang.IllegalStateException", { status: 500 }));
    const response = await me();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("IllegalState");
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("la sesion se devuelve tal cual", async () => {
    backendFetch.mockResolvedValue(new Response(JSON.stringify({ user: { type: "employee" } }), { status: 200 }));
    const response = await me();
    expect(await response.json()).toEqual({ user: { type: "employee" } });
  });

  it("sin backend responde 503", async () => {
    vi.stubEnv("OMNIRETAIL_API_URL", "");
    const response = await me();
    expect(response.status).toBe(503);
  });
});
