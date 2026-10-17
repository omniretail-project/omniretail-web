import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/media/[...path]/route";

const fetchSpy = vi.fn();

function request() {
  return new NextRequest("http://localhost/api/media/tenant/catalog/image.png");
}

function context(path = ["tenant", "catalog", "image.png"]) {
  return { params: Promise.resolve({ path }) };
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
  vi.stubEnv("OMNIRETAIL_API_URL", "http://backend.internal/api");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("WEB-02: proxy publico de medios", () => {
  it("transmite integra una imagen 200, conserva headers permitidos y agrega nosniff", async () => {
    const first = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    const second = Uint8Array.of(1, 2, 3, 4);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          ETag: '"media-v1"',
          "Cache-Control": "public, max-age=3600",
          "Last-Modified": "Fri, 16 Oct 2026 00:00:00 GMT",
          "Set-Cookie": "backend_session=secret",
          Authorization: "Bearer internal",
          "X-Internal-Trace": "secret-trace",
        },
      }),
    );

    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("ETag")).toBe('"media-v1"');
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Last-Modified")).toBe("Fri, 16 Oct 2026 00:00:00 GMT");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Authorization")).toBeNull();
    expect(response.headers.get("X-Internal-Trace")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([...first, ...second]),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://backend.internal/media/tenant/catalog/image.png",
      { cache: "no-store" },
    );
  });

  it("impone nosniff aunque el backend no lo envie", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(Uint8Array.of(1), { headers: { "Content-Type": "image/webp" } }),
    );

    const response = await GET(request(), context());
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Type")).toBe("image/webp");
  });

  it("mantiene el 404 y el cuerpo devueltos por el backend", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"code":"MEDIA_NOT_FOUND"}', {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await GET(request(), context());
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe('{"code":"MEDIA_NOT_FOUND"}');
  });

  it.each([204, 205, 304])("omite el body para una respuesta HTTP %s", async (status) => {
    let pulls = 0;
    const forbiddenBody = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(Uint8Array.of(1));
        },
      },
      { highWaterMark: 0 },
    );
    fetchSpy.mockResolvedValueOnce({
      status,
      headers: new Headers({
        "Content-Type": "image/png",
        ETag: '"not-modified"',
        "Cache-Control": "public, max-age=60",
      }),
      body: forbiddenBody,
    } as Response);

    const response = await GET(request(), context());
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("ETag")).toBe('"not-modified"');
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(pulls).toBe(0);
  });

  it("responde 503 sin detalles internos cuando fetch no puede conectar", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("connect ECONNREFUSED backend.internal"));

    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = await response.json();
    expect(body.code).toBe("SERVICE_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("backend.internal");
  });

  it("responde 503 si la URL configurada del backend es invalida", async () => {
    vi.stubEnv("OMNIRETAIL_API_URL", "url no valida");

    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza una ruta invalida sin llamar al backend", async () => {
    const response = await GET(request(), context(["..", "image.png"]));
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza una ruta vacia sin llamar al backend", async () => {
    const response = await GET(request(), context([]));
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mantiene bloqueado el backend real en demo publica", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");

    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({
      status: 503,
      code: "PUBLIC_DEMO_BACKEND_DISABLED",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propaga un fallo del stream sin convertir bytes truncados en una imagen valida", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2));
        controller.error(new Error("upstream interrumpido"));
      },
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { "Content-Type": "image/png" } }),
    );

    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow("upstream interrumpido");
  });
});
