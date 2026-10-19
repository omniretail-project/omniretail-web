import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "user-jwt" }), set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers({ "X-Forwarded-For": "203.0.113.7" }),
}));

import { POST } from "@/app/api/public/contact-requests/route";

const fetchSpy = vi.fn();
const KEY = "0b3c1f5e-8a6d-4c1e-9d2a-3f4b5c6d7e8f";
const REQUEST_ID = "7d444840-9dc0-41d3-8a59-6a8a6c0f1e11";

const validBody = {
  fullName: "Ana Pérez",
  businessName: "Ferretería Los Altos",
  email: "ana@example.com",
  phone: "+502 1234 5678",
  industry: "hardware",
  modules: ["inventory", "pos"],
  message: "",
  consentAccepted: true,
  consentVersion: "2026-10",
  website: "",
  captchaToken: "",
};

function call(body: unknown = validBody, headers: Record<string, string> = {}, raw?: string) {
  return POST(
    new Request("http://localhost:3000/api/public/contact-requests", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "Idempotency-Key": KEY,
        ...headers,
      },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

function accepted() {
  return new Response(JSON.stringify({ requestId: REQUEST_ID, status: "RECEIVED", extra: "x" }), {
    status: 202,
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("OMNIRETAIL_API_URL", "http://backend.internal/api/v1");
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
  vi.stubEnv("APP_ORIGIN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/public/contact-requests", () => {
  it("reenvia solo el contrato permitido, con Idempotency-Key y sin credenciales de usuario", async () => {
    fetchSpy.mockResolvedValue(accepted());

    const response = await call();

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ requestId: REQUEST_ID, status: "RECEIVED" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://backend.internal/api/v1/public/contact-requests");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(KEY);
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Cookie).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual(validBody);
  });

  it("no copia cabeceras de IP propias del navegador", async () => {
    fetchSpy.mockResolvedValue(accepted());
    await call(validBody, { "X-Real-IP": "1.2.3.4", Forwarded: "for=1.2.3.4" });
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Real-IP"]).toBeUndefined();
    expect(headers.Forwarded).toBeUndefined();
  });

  it("rechaza un origen distinto con 403 sin llamar al backend", async () => {
    const response = await call(validBody, { Origin: "http://evil.test" });
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exige una Idempotency-Key valida", async () => {
    const response = await call(validBody, { "Idempotency-Key": "no-es-uuid" });
    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza un cuerpo que no es JSON con 415", async () => {
    const response = await call(validBody, { "Content-Type": "text/plain" });
    expect(response.status).toBe(415);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza cuerpos demasiado grandes con 413", async () => {
    const response = await call({ ...validBody, message: "a".repeat(40_000) });
    expect(response.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza JSON ilegible y campos desconocidos con 400", async () => {
    expect((await call(undefined, {}, "{no-json")).status).toBe(400);
    expect((await call({ ...validBody, isAdmin: true })).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("valida el consentimiento y devuelve errores por campo", async () => {
    const response = await call({ ...validBody, consentAccepted: false });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields.consentAccepted).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...validBody, fullName: "A" }, "fullName"],
    [{ ...validBody, fullName: "A".repeat(101) }, "fullName"],
    [{ ...validBody, businessName: "B".repeat(121) }, "businessName"],
    [{ ...validBody, email: `${"a".repeat(243)}@example.com` }, "email"],
    [{ ...validBody, phone: "123456" }, "phone"],
    [{ ...validBody, phone: "1".repeat(21) }, "phone"],
    [{ ...validBody, phone: "123.456" }, "phone"],
    [{ ...validBody, message: "M".repeat(1001) }, "message"],
    [{ ...validBody, industry: "unknown" }, "industry"],
    [{ ...validBody, modules: [] }, "modules"],
    [{ ...validBody, modules: ["inventory", "unknown"] }, "modules"],
  ])("rechaza límites o listas cerradas fuera de contrato en %s", async (input, field) => {
    const response = await call(input);
    expect(response.status).toBe(400);
    expect((await response.json()).fields[field]).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza controles antes de normalizar y no reenvía el cuerpo", async () => {
    const response = await call({ ...validBody, fullName: " Ana Pérez\u0000 " });
    expect(response.status).toBe(400);
    expect((await response.json()).fields.fullName).toContain("control");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("un 202 sin requestId valido no se presenta como exito", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ status: "RECEIVED" }), { status: 202 }));
    const response = await call();
    expect(response.status).toBe(502);
  });

  it.each([404, 429, 503])("propaga %s del backend sin filtrar detalles", async (status) => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: "detalle interno backend.internal" }), {
        status,
        headers: status === 429 ? { "Retry-After": "60" } : {},
      }),
    );
    const response = await call();
    expect(response.status).toBe(status);
    if (status === 429) expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("un fallo de red nunca responde 202", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
    const response = await call();
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  it("sin backend configurado responde 503 sin falso exito", async () => {
    vi.stubEnv("OMNIRETAIL_API_URL", "");
    const response = await call();
    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("en la demo publica nunca llega al backend", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    const response = await call();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("PUBLIC_DEMO_BACKEND_DISABLED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
