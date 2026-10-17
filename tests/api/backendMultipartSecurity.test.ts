import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieState = vi.hoisted(() => ({
  token: "jwt-seguro" as string | undefined,
  delete: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieState.token ? { value: cookieState.token } : undefined),
    delete: cookieState.delete,
  }),
}));

import { JSON_BODY_MAX_BYTES, MULTIPART_BODY_MAX_BYTES } from "@/app/api/_lib/limited-body";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/backend/[...path]/route";

const BACKEND_URL = "http://backend.internal/api";
const BOUNDARY = "----omniretail-security-boundary";
const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const encoder = new TextEncoder();
const fetchSpy = vi.fn();

function context(path = ["catalog", "products", "p-1", "media", "upload"]) {
  return { params: Promise.resolve({ path }) };
}

function request(body: BodyInit | null, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/backend/catalog/products/p-1/media/upload", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "Content-Type": CONTENT_TYPE,
      ...headers,
    },
    body,
  });
}

function streamRequest(
  stream: ReadableStream<Uint8Array>,
  contentType = CONTENT_TYPE,
): NextRequest {
  return new NextRequest("http://localhost/api/backend/catalog/products/p-1/media/upload", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": contentType },
    body: stream,
    duplex: "half",
  } as never);
}

function jsonRequest(body: BodyInit | null, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/backend/catalog/products", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "Content-Type": JSON_CONTENT_TYPE,
      ...headers,
    },
    body,
  });
}

function multipartWithFile(fileSize: number): Uint8Array<ArrayBuffer> {
  const prefix = encoder.encode(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${BOUNDARY}--\r\n`);
  const body = new Uint8Array(prefix.byteLength + fileSize + suffix.byteLength);
  body.set(prefix);
  body.fill(0x61, prefix.byteLength, prefix.byteLength + fileSize);
  body.set(suffix, prefix.byteLength + fileSize);
  return body;
}

function jsonBodyWithSize(size: number): Uint8Array<ArrayBuffer> {
  const prefix = encoder.encode('{"value":"');
  const suffix = encoder.encode('"}');
  if (size < prefix.byteLength + suffix.byteLength) throw new Error("Tamano JSON invalido.");
  const body = new Uint8Array(size);
  body.set(prefix);
  body.fill(0x61, prefix.byteLength, size - suffix.byteLength);
  body.set(suffix, size - suffix.byteLength);
  return body;
}

async function expectPayloadTooLarge(
  response: Response,
  expectedPath = "/api/backend/catalog/products/p-1/media/upload",
) {
  expect(response.status).toBe(413);
  await expect(response.json()).resolves.toMatchObject({
    status: 413,
    error: "Payload Too Large",
    code: "PAYLOAD_TOO_LARGE",
    path: expectedPath,
  });
  expect(fetchSpy).not.toHaveBeenCalled();
}

beforeEach(() => {
  cookieState.token = "jwt-seguro";
  cookieState.delete.mockReset();
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(
    new Response('{"ok":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
  vi.stubEnv("OMNIRETAIL_API_URL", BACKEND_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("WEB-01: limite real del multipart en el BFF", () => {
  it("reenvia un multipart valido sin Content-Length y conserva body, boundary, sesion e idempotencia", async () => {
    const body = multipartWithFile(32);
    const incoming = request(body, { "Idempotency-Key": "upload-1" });
    expect(incoming.headers.get("Content-Length")).toBeNull();

    const response = await POST(incoming, context());
    expect(response.status).toBe(200);
    await response.arrayBuffer();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BACKEND_URL}/catalog/products/p-1/media/upload`);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer jwt-seguro",
      "Content-Type": CONTENT_TYPE,
      "Idempotency-Key": "upload-1",
    });
    expect(Array.from(init.body as Uint8Array)).toEqual(Array.from(body));
  });

  it("rechaza el stream real cuando supera 6 MiB aunque no haya Content-Length", async () => {
    await expectPayloadTooLarge(
      await POST(request(new Uint8Array(MULTIPART_BODY_MAX_BYTES + 1)), context()),
    );
  });

  it("rechaza anticipadamente un Content-Length valido superior al limite", async () => {
    await expectPayloadTooLarge(
      await POST(
        request(Uint8Array.of(1), {
          "Content-Length": String(MULTIPART_BODY_MAX_BYTES + 1),
        }),
        context(),
      ),
    );
  });

  it("no confia en un Content-Length falso menor que el stream real", async () => {
    await expectPayloadTooLarge(
      await POST(
        request(new Uint8Array(MULTIPART_BODY_MAX_BYTES + 1), { "Content-Length": "10" }),
        context(),
      ),
    );
  });

  it("cancela de forma determinista el productor al superar el limite", async () => {
    let pulls = 0;
    let cancelCalls = 0;
    let cancelFinished = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(new Uint8Array(MULTIPART_BODY_MAX_BYTES));
          else controller.enqueue(Uint8Array.of(1));
        },
        async cancel() {
          cancelCalls += 1;
          await Promise.resolve();
          cancelFinished = true;
        },
      },
      { highWaterMark: 0 },
    );

    await expectPayloadTooLarge(await POST(streamRequest(stream), context()));
    expect(pulls).toBe(2);
    expect(cancelCalls).toBe(1);
    expect(cancelFinished).toBe(true);
  });

  it("mantiene el 413 aunque la cancelacion del productor falle", async () => {
    let cancelCalls = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(MULTIPART_BODY_MAX_BYTES + 1));
        },
        cancel() {
          cancelCalls += 1;
          throw new Error("fallo al cancelar");
        },
      },
      { highWaterMark: 0 },
    );

    await expectPayloadTooLarge(await POST(streamRequest(stream), context()));
    expect(cancelCalls).toBe(1);
  });

  it("acepta un archivo de exactamente 5 MiB mas el overhead multipart", async () => {
    const body = multipartWithFile(IMAGE_MAX_BYTES);
    expect(body.byteLength).toBeLessThan(MULTIPART_BODY_MAX_BYTES);

    const response = await POST(request(body), context());
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("acepta un cuerpo de exactamente 6 MiB", async () => {
    const body = new Uint8Array(MULTIPART_BODY_MAX_BYTES);
    body[0] = 1;
    body[body.byteLength - 1] = 2;

    const response = await POST(request(body), context());
    expect(response.status).toBe(200);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect((init.body as Uint8Array).byteLength).toBe(MULTIPART_BODY_MAX_BYTES);
  });

  it("reenvia un multipart vacio sin body ni Content-Type", async () => {
    const response = await POST(request(new Uint8Array()), context());
    expect(response.status).toBe(200);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty("Content-Type");
  });

  it("responde 400 y no llama al backend si falla la lectura del stream", async () => {
    let pull = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pull++ === 0) controller.enqueue(Uint8Array.of(1, 2, 3));
        else controller.error(new Error("fallo de transporte"));
      },
    });

    const response = await POST(streamRequest(stream), context());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: 400,
      code: "INVALID_REQUEST_BODY",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza multipart sin boundary con 415 y sin llamar al backend", async () => {
    const response = await POST(
      request(Uint8Array.of(1), { "Content-Type": "multipart/form-data" }),
      context(),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mantiene el control de Origin antes de leer o reenviar el cuerpo", async () => {
    const incoming = request(Uint8Array.of(1));
    incoming.headers.set("Origin", "https://evil.example");

    const response = await POST(incoming, context());
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mantiene bloqueadas las rutas /auth del puente generico", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/backend/auth/me"),
      context(["auth", "me"]),
    );
    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechaza una ruta vacia sin llamar al backend", async () => {
    const response = await GET(new NextRequest("http://localhost/api/backend"), context([]));
    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["PUT", PUT],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ] as const)("conserva el metodo mutador %s", async (method, handler) => {
    const incoming = new NextRequest("http://localhost/api/backend/catalog/products/p-1", {
      method,
      headers: { Origin: "http://localhost" },
    });

    const response = await handler(incoming, context(["catalog", "products", "p-1"]));
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${BACKEND_URL}/catalog/products/p-1`,
      expect.objectContaining({ method }),
    );
  });

  it("mantiene el flujo JSON sin regresion", async () => {
    const json = '{"name":"Producto"}';
    const incoming = jsonRequest(json);

    const response = await POST(incoming, context(["catalog", "products"]));
    expect(response.status).toBe(200);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(json);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer jwt-seguro",
      "Content-Type": JSON_CONTENT_TYPE,
    });
  });

  it("mantiene la invalidacion de la cookie ante 401 del backend", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const response = await POST(request(Uint8Array.of(1)), context());
    expect(response.status).toBe(401);
    expect(cookieState.delete).toHaveBeenCalledWith("omniretail_session");
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
      headers: new Headers({ "Content-Type": "application/json" }),
      body: forbiddenBody,
    } as Response);

    const response = await GET(
      new NextRequest("http://localhost/api/backend/catalog/products"),
      context(["catalog", "products"]),
    );
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(pulls).toBe(0);
  });
});

describe("SEC-02: limite real de JSON en el BFF", () => {
  it("reenvia JSON valido sin Content-Length", async () => {
    const json = '{"name":"Producto"}';
    const incoming = jsonRequest(json);
    expect(incoming.headers.get("Content-Length")).toBeNull();

    const response = await POST(incoming, context(["catalog", "products"]));
    expect(response.status).toBe(200);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(json);
  });

  it("mantiene vacio un JSON sin body", async () => {
    const response = await POST(jsonRequest(null), context(["catalog", "products"]));
    expect(response.status).toBe(200);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty("Content-Type");
  });

  it("preserva exactamente los bytes UTF-8 multibyte", async () => {
    const json = JSON.stringify({ name: String.fromCodePoint(0xe9, 0x1f680, 0x2014) });
    const bytes = encoder.encode(json);

    const response = await POST(jsonRequest(bytes), context(["catalog", "products"]));
    expect(response.status).toBe(200);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(Array.from(init.body as Uint8Array)).toEqual(Array.from(bytes));
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(json);
  });

  it("acepta un body de exactamente 2 MiB", async () => {
    const body = jsonBodyWithSize(JSON_BODY_MAX_BYTES);

    const response = await POST(jsonRequest(body), context(["catalog", "products"]));
    expect(response.status).toBe(200);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect((init.body as Uint8Array).byteLength).toBe(JSON_BODY_MAX_BYTES);
  });

  it("rechaza un body superior a 2 MiB sin llamar al backend", async () => {
    await expectPayloadTooLarge(
      await POST(
        jsonRequest(jsonBodyWithSize(JSON_BODY_MAX_BYTES + 1)),
        context(["catalog", "products"]),
      ),
      "/api/backend/catalog/products",
    );
  });

  it("rechaza Content-Length valido superior al limite", async () => {
    await expectPayloadTooLarge(
      await POST(
        jsonRequest(Uint8Array.of(0x7b, 0x7d), {
          "Content-Length": String(JSON_BODY_MAX_BYTES + 1),
        }),
        context(["catalog", "products"]),
      ),
      "/api/backend/catalog/products",
    );
  });

  it("rechaza Content-Length superior aunque la solicitud no tenga stream", async () => {
    await expectPayloadTooLarge(
      await POST(
        jsonRequest(null, { "Content-Length": String(JSON_BODY_MAX_BYTES + 1) }),
        context(["catalog", "products"]),
      ),
      "/api/backend/catalog/products",
    );
  });

  it("ignora Content-Length sintacticamente invalido y mide el body real", async () => {
    const response = await POST(
      jsonRequest(Uint8Array.of(0x7b, 0x7d), { "Content-Length": "invalido" }),
      context(["catalog", "products"]),
    );
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("no confia en Content-Length falsificado por debajo del body real", async () => {
    await expectPayloadTooLarge(
      await POST(
        jsonRequest(jsonBodyWithSize(JSON_BODY_MAX_BYTES + 1), { "Content-Length": "2" }),
        context(["catalog", "products"]),
      ),
      "/api/backend/catalog/products",
    );
  });

  it("responde 400 y no llama al backend si falla el stream JSON", async () => {
    let pull = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pull++ === 0) controller.enqueue(Uint8Array.of(0x7b));
        else controller.error(new Error("fallo JSON"));
      },
    });

    const response = await POST(
      streamRequest(stream, JSON_CONTENT_TYPE),
      context(["catalog", "products"]),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: 400,
      code: "INVALID_REQUEST_BODY",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
