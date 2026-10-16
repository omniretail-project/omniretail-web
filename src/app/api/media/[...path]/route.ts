import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl, serviceUnavailable } from "@/app/api/_lib/backend";

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
    { status: 404 },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const path = mediaPath((await context.params).path);
  if (!path) return notFound(request);

  const configuredUrl = getBackendBaseUrl();
  if (!configuredUrl) return serviceUnavailable();

  let backendOrigin: string;
  try {
    backendOrigin = new URL(configuredUrl).origin;
  } catch {
    return serviceUnavailable();
  }

  let response: Response;
  try {
    response = await fetch(`${backendOrigin}${path}`, { cache: "no-store" });
  } catch {
    return serviceUnavailable();
  }

  const headers = new Headers();
  for (const name of ["Content-Type", "Last-Modified", "ETag", "Cache-Control"] as const) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  const payload = response.status === 204 ? null : await response.arrayBuffer();
  return new NextResponse(payload && payload.byteLength > 0 ? payload : null, {
    status: response.status,
    headers,
  });
}
