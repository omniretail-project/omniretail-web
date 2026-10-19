import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  callBackend: vi.fn(),
  forwardBackendError: vi.fn(),
  serviceUnavailable: vi.fn(),
}));

vi.mock("@/app/api/_lib/backend", () => ({
  callBackend: state.callBackend,
  forwardBackendError: state.forwardBackendError,
  serviceUnavailable: state.serviceUnavailable,
}));

import { GET } from "@/app/api/public/[slug]/receipt/[token]/route";

describe("GET /api/public/[slug]/receipt/[token]", () => {
  beforeEach(() => {
    state.callBackend.mockReset();
    state.forwardBackendError.mockReset();
    state.serviceUnavailable.mockReset();
  });

  const context = { params: Promise.resolve({ slug: "ferre pharma", token: "token/123" }) };

  it("devuelve el PDF del backend con su nombre de archivo", async () => {
    state.callBackend.mockResolvedValue(
      new Response("pdf", {
        headers: { "Content-Disposition": 'attachment; filename="orden.pdf"' },
      }),
    );

    const response = await GET(new Request("http://localhost/api/public/receipt") as never, context);

    expect(state.callBackend).toHaveBeenCalledWith(
      "/public/ferre%20pharma/receipt/token%2F123",
      { method: "GET" },
    );
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="orden.pdf"');
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    await expect(response.text()).resolves.toBe("pdf");
  });

  it("responde con el servicio no disponible cuando no hay backend", async () => {
    const unavailable = new Response("unavailable", { status: 503 });
    state.callBackend.mockResolvedValue(null);
    state.serviceUnavailable.mockReturnValue(unavailable);

    await expect(GET(new Request("http://localhost") as never, context)).resolves.toBe(unavailable);
  });

  it("reenvía los errores del backend", async () => {
    const backendError = new Response("not found", { status: 404 });
    const forwarded = new Response("not found", { status: 404 });
    state.callBackend.mockResolvedValue(backendError);
    state.forwardBackendError.mockResolvedValue(forwarded);

    await expect(GET(new Request("http://localhost") as never, context)).resolves.toBe(forwarded);
    expect(state.forwardBackendError).toHaveBeenCalledWith(backendError);
  });

  it("asigna un nombre seguro cuando el backend no envía Content-Disposition", async () => {
    state.callBackend.mockResolvedValue(new Response("pdf"));

    const response = await GET(new Request("http://localhost") as never, context);

    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="comprobante-pedido.pdf"',
    );
  });
});
