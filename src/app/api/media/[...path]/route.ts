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
