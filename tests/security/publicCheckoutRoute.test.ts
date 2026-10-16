import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/public/[slug]/checkout/route";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const cookieStore = { get: vi.fn() };
const context = { params: Promise.resolve({ slug: "ferreteria" }) };

function checkoutRequest(origin: string | null) {
  return new NextRequest("https://tienda.example/api/public/ferreteria/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
      "Idempotency-Key": "checkout-1",
    },
    body: JSON.stringify({ items: [] }),
  });
}

describe("public checkout route", () => {
  beforeEach(() => {
    process.env.OMNIRETAIL_API_URL = "https://api.example/api/v1";
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);
    cookieStore.get.mockReturnValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ orderId: "order-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })),
    );
  });

  it("rechaza un origen externo antes de leer cookies o reenviar el checkout", async () => {
    const response = await POST(checkoutRequest("https://evil.example"), context);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(cookies).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rechaza solicitudes de navegador sin Origin igual que el proxy general", async () => {
    const response = await POST(checkoutRequest(null), context);

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("acepta checkout invitado del mismo origen y conserva idempotencia", async () => {
    const response = await POST(checkoutRequest("https://tienda.example"), context);

    expect(response.status).toBe(201);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example/api/v1/public/ferreteria/checkout",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "checkout-1" }),
      }),
    );
  });
});
