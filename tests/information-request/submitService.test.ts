import { describe, expect, it, vi } from "vitest";
import type { InformationRequestPayload } from "@/modules/information-request/application/dto/InformationRequestDto";
import { SubmitInformationRequestService } from "@/modules/information-request/application/services/SubmitInformationRequestService";

const KEY = "0b3c1f5e-8a6d-4c1e-9d2a-3f4b5c6d7e8f";
const REQUEST_ID = "7d444840-9dc0-41d3-8a59-6a8a6c0f1e11";
const payload: InformationRequestPayload = {
  fullName: "Ana Pérez",
  businessName: "Ferretería",
  email: "ana@example.com",
  phone: "+502 1234 5678",
  industry: "hardware",
  modules: ["inventory"],
  message: "",
  consentAccepted: true,
  consentVersion: "2026-10",
  website: "",
  captchaToken: "",
};

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function run(response: Response | Error) {
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const service = new SubmitInformationRequestService(fetchImpl as unknown as typeof fetch, 50);
  return { fetchImpl, result: service.execute(payload, KEY) };
}

describe("SubmitInformationRequestService", () => {
  it("no llama al proxy si el payload viola el contrato compartido", async () => {
    const fetchImpl = vi.fn();
    const service = new SubmitInformationRequestService(fetchImpl as unknown as typeof fetch);
    const result = await service.execute({ ...payload, fullName: "A" }, KEY);
    expect(result).toMatchObject({ status: "invalid", fields: { fullName: expect.any(String) } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("envia Idempotency-Key, sin credenciales, y confirma solo con 202 valido", async () => {
    const { fetchImpl, result } = run(json(202, { requestId: REQUEST_ID, status: "RECEIVED" }));
    expect(await result).toEqual({ status: "received", requestId: REQUEST_ID });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/public/contact-requests");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(KEY);
    expect(init.credentials).toBe("omit");
  });

  it("un 202 sin requestId valido es incierto, no exito", async () => {
    expect((await run(json(202, { status: "RECEIVED" })).result).status).toBe("uncertain");
    expect((await run(json(202, { requestId: "x", status: "RECEIVED" })).result).status).toBe("uncertain");
  });

  it("400 devuelve errores por campo", async () => {
    const result = await run(json(400, { fields: { email: "Correo no válido" } })).result;
    expect(result).toMatchObject({ status: "invalid", fields: { email: "Correo no válido" } });
  });

  it.each([
    [403, "forbidden"],
    [404, "disabled"],
    [411, "too_large"],
    [413, "too_large"],
    [429, "rate_limited"],
    [503, "unavailable"],
  ])("%s -> fallo %s sin exito", async (status, kind) => {
    const result = await run(json(status, {})).result;
    expect(result).toMatchObject({ status: "failed", kind });
  });

  it("distingue servicio comercial apagado (404) de proxy/backend no disponible (503)", async () => {
    const disabled = await run(json(404, {})).result;
    const unavailable = await run(json(503, {})).result;
    expect(disabled).toMatchObject({ status: "failed", kind: "disabled" });
    expect(unavailable).toMatchObject({ status: "failed", kind: "unavailable" });
    if (disabled.status === "failed" && unavailable.status === "failed") {
      expect(disabled.message).toContain("formulario no está disponible");
      expect(unavailable.message).toContain("servicio no está disponible temporalmente");
    }
  });

  it("429 respeta Retry-After", async () => {
    const result = await run(json(429, {}, { "Retry-After": "90" })).result;
    expect(result).toMatchObject({ retryAfterSeconds: 90 });
  });

  it.each([500, 502, 504])("%s es incierto (puede haberse registrado)", async (status) => {
    expect((await run(json(status, {})).result).status).toBe("uncertain");
  });

  it("red caida o timeout son inciertos", async () => {
    expect((await run(new TypeError("network")).result).status).toBe("uncertain");
    const slow = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("t", "AbortError")));
        }),
    );
    const result = await new SubmitInformationRequestService(slow as unknown as typeof fetch, 10).execute(
      payload,
      KEY,
    );
    expect(result.status).toBe("uncertain");
  });
});
