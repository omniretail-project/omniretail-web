import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserType } from "@/core/enums";
import { ApiAuthRepository } from "@/infrastructure/api/ApiAuthRepository";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import { subscribeSessionExpired } from "@/infrastructure/api/sessionExpiredSignal";
import { sessionExpiredLoginHref } from "@/modules/auth/application/services/sessionExpiredLoginHref";

const fetchSpy = vi.fn();
const onExpired = vi.fn();
let unsubscribe: () => void;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  fetchSpy.mockReset();
  onExpired.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  unsubscribe = subscribeSessionExpired(onExpired);
});

afterEach(() => {
  unsubscribe();
  vi.unstubAllGlobals();
});

describe("backendFetch avisa la sesion expirada", () => {
  it("un 401 avisa una vez y el caller igual recibe el BackendRequestError", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, { code: "UNAUTHORIZED", message: "Sesion invalida" }));

    const request = backendFetch("/catalog/products");

    await expect(request).rejects.toBeInstanceOf(BackendRequestError);
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404, 500])("un %i no avisa", async (status) => {
    fetchSpy.mockResolvedValue(jsonResponse(status, { message: "Error" }));

    await expect(backendFetch("/catalog/products")).rejects.toMatchObject({ status });
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("un error de red no avisa", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(backendFetch("/catalog/products")).rejects.toMatchObject({ status: 0 });
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("una respuesta correcta no avisa", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { items: [] }));

    await expect(backendFetch("/catalog/products")).resolves.toEqual({ items: [] });
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("los 401 del propio login y de MFA no avisan (no pasan por backendFetch)", async () => {
    const repository = new ApiAuthRepository({} as never, {} as never, {} as never);
    fetchSpy.mockResolvedValue(jsonResponse(401, { code: "INVALID_CREDENTIALS", message: "Credenciales" }));

    await expect(
      repository.login({ email: "ana@tienda.test", passwordMock: "x", expectedUserType: UserType.employee } as never),
    ).rejects.toThrow();
    await expect(repository.verifyMfaChallenge("challenge", "123456")).rejects.toThrow();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("deja de avisar al cancelar la suscripcion", async () => {
    unsubscribe();
    fetchSpy.mockResolvedValue(jsonResponse(401, {}));

    await expect(backendFetch("/catalog/products")).rejects.toMatchObject({ status: 401 });
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("sessionExpiredLoginHref", () => {
  it("el cliente vuelve al login de su tienda", () => {
    expect(sessionExpiredLoginHref("/tienda/ferrepharma-demo/cuenta/pedidos")).toBe(
      "/tienda/ferrepharma-demo/iniciar-sesion?sesion=expirada",
    );
  });

  it.each(["/inicio", "/cuenta", "/", "/tienda"])("%s va al login de personal", (pathname) => {
    expect(sessionExpiredLoginHref(pathname)).toBe("/iniciar-sesion?sesion=expirada");
  });
});
