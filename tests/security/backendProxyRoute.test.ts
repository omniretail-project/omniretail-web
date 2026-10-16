import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/backend/[...path]/route";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const cookieStore = { get: vi.fn() };
const context = { params: Promise.resolve({ path: ["media", "upload"] }) };
const origin = "https://tienda.example";
const multipartContentType = "multipart/form-data; boundary=omniretail-boundary";

function requestWith(body: BodyInit, extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/backend/media/upload`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": multipartContentType, ...extraHeaders },
    body,
  });
}

describe("backend proxy multipart limit", () => {
  beforeEach(() => {
    process.env.OMNIRETAIL_API_URL = "https://api.example/api/v1";
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);
    cookieStore.get.mockReturnValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );
  });

  it("reenvía un multipart pequeño preservando el boundary original", async () => {
    const response = await POST(requestWith("--omniretail-boundary\r\nsmall\r\n--omniretail-boundary--"), context);

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example/api/v1/media/upload",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": multipartContentType }),
      }),
    );
  });

  it("rechaza por Content-Length antes de reenviar un multipart demasiado grande", async () => {
    const response = await POST(
      requestWith("small", { "Content-Length": String(5 * 1024 * 1024 + 64 * 1024 + 1) }),
      context,
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rechaza un multipart sin Content-Length cuando supera el límite durante la lectura", async () => {
    const response = await POST(requestWith("x".repeat(5 * 1024 * 1024 + 64 * 1024 + 1)), context);

    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
});
