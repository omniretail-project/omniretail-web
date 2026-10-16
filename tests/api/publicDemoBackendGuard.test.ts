import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "jwt" }), set: vi.fn(), delete: vi.fn() }),
}));

import { callBackend, getBackendBaseUrl } from "@/app/api/_lib/backend";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as bridge } from "@/app/api/backend/[...path]/route";
import { GET as media } from "@/app/api/media/[...path]/route";
import { POST as checkout } from "@/app/api/public/[slug]/checkout/route";
import { GET as tracking } from "@/app/api/public/[slug]/tracking/[token]/route";

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
  vi.stubEnv("OMNIRETAIL_API_URL", "http://backend.internal/api");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function expectDisabled(response: Response) {
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.code).toBe("PUBLIC_DEMO_BACKEND_DISABLED");
  expect(body.status).toBe(503);
  expect(JSON.stringify(body)).not.toContain("backend.internal");
}

describe("demo publica: el servidor nunca habla con el backend real", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true"));

  it("el helper central rechaza aunque OMNIRETAIL_API_URL este definida", async () => {
    expect(getBackendBaseUrl()).toBeNull();
    expect(await callBackend("/x", { method: "GET" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("login responde el error controlado", async () => {
    const request = new Request("http://localhost/api/auth/login", { method: "POST", body: "{}" });
    await expectDisabled(await login(request));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("el puente /api/backend responde el error controlado", async () => {
    const request = new NextRequest("http://localhost/api/backend/products");
    await expectDisabled(await bridge(request, { params: Promise.resolve({ path: ["products"] }) }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("media responde el error controlado", async () => {
    const request = new NextRequest("http://localhost/api/media/a.png");
    await expectDisabled(await media(request, { params: Promise.resolve({ path: ["a.png"] }) }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("checkout y tracking publicos responden el error controlado", async () => {
    const post = new NextRequest("http://localhost/api/public/t/checkout", { method: "POST", body: "{}" });
    await expectDisabled(await checkout(post, { params: Promise.resolve({ slug: "t" }) }));
    const get = new NextRequest("http://localhost/api/public/t/tracking/abc");
    await expectDisabled(await tracking(get, { params: Promise.resolve({ slug: "t", token: "abc" }) }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sin la bandera de demo el comportamiento no cambia", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", ""));

  it("el helper devuelve la URL y callBackend llama al backend", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(getBackendBaseUrl()).toBe("http://backend.internal/api");
    await callBackend("/x", { method: "GET" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://backend.internal/api/x",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("media sigue usando el origen del backend y el 503 conserva su codigo", async () => {
    fetchSpy.mockResolvedValue(new Response("img", { status: 200 }));
    const request = new NextRequest("http://localhost/api/media/a.png");
    const response = await media(request, { params: Promise.resolve({ path: ["a.png"] }) });
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith("http://backend.internal/media/a.png", expect.anything());

    vi.stubEnv("OMNIRETAIL_API_URL", "");
    const unconfigured = await media(request, { params: Promise.resolve({ path: ["a.png"] }) });
    expect((await unconfigured.json()).code).toBe("SERVICE_UNAVAILABLE");
  });
});
