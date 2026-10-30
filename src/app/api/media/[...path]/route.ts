import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl, serviceUnavailable } from "@/app/api/_lib/backend";
import { isBackendManagedMediaUrl } from "@/infrastructure/api/mediaUrl";

/**
 * El backend publica cada imagen con un UUID nuevo (nunca sobrescribe el archivo): la URL identifica
 * un contenido fijo y el navegador puede conservarla sin revalidar.
 */
const IMMUTABLE_MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

type RouteContext = { params: Promise<{ path: string[] }> };

function mediaPath(segments: string[]): string | null {
  if (segments.length === 0) return null;
  const invalid = segments.some(
    (segment) => segment === "" || segment === "." || segment === ".." || /[/\\]/.test(segment),
  );
  return invalid ? null : `/media/${segments.map(encodeURIComponent).join("/")}`;
}

function notFound(request: NextRequest) {
  return NextResponse.json(
    {
      status: 404,
      error: "Not Found",
      code: "NOT_FOUND",
      message: "Recurso no encontrado.",
      path: request.nextUrl.pathname,
      timestamp: new Date().toISOString(),
    },
    { status: 404, headers: { "X-Content-Type-Options": "nosniff" } },
  );
}

function unavailableWithNoSniff() {
  const response = serviceUnavailable();
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const path = mediaPath((await context.params).path);
  if (!path) return notFound(request);

  const configuredUrl = getBackendBaseUrl();
  if (!configuredUrl) return unavailableWithNoSniff();

  let backendOrigin: string;
  try {
    backendOrigin = new URL(configuredUrl).origin;
  } catch {
    return unavailableWithNoSniff();
  }

  let response: Response;
  try {
    response = await fetch(`${backendOrigin}${path}`, { cache: "no-store" });
  } catch {
    return unavailableWithNoSniff();
  }

  const headers = new Headers();
  for (const name of ["Content-Type", "Last-Modified", "ETag", "Cache-Control"] as const) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Spring solo envia Last-Modified: sin politica propia, cada visita volvia a pedir la imagen.
  if (response.status === 200 && !headers.has("Cache-Control") && isBackendManagedMediaUrl(path)) {
    headers.set("Cache-Control", IMMUTABLE_MEDIA_CACHE_CONTROL);
  }
  headers.set("X-Content-Type-Options", "nosniff");
  const responseBody =
    response.status === 204 || response.status === 205 || response.status === 304
      ? null
      : response.body;
  return new NextResponse(responseBody, {
    status: response.status,
    headers,
  });
}
