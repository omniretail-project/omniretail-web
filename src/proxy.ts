import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/app/api/_lib/backend";
import { isApiMode } from "@/config/api-mode";

/**
 * Guard MINIMO del lado del servidor (proxy de Next 16): en las rutas privadas, sin la cookie de
 * sesion redirige al login antes de cargar la pagina. Solo comprueba que la cookie exista: no valida
 * el JWT, roles ni permisos (eso sigue en `/api/auth/me`, RequireSession, RequirePermission y el
 * backend). En modo mock la sesion vive en el navegador, asi que no hace nada.
 *
 * Solo corre en las rutas de `config.matcher` (allowlist de rutas privadas): `/api`, `/_next`, los
 * estaticos y las rutas publicas quedan fuera por diseño.
 */
export function proxy(request: NextRequest): NextResponse {
  if (!isApiMode() || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL(loginPathFor(request.nextUrl.pathname), request.url));
}

/** El cliente de una tienda vuelve al login de ESA tienda; el resto, al login de personal. */
function loginPathFor(pathname: string): string {
  const [first, slug] = pathname.split("/").filter(Boolean);
  return first === "tienda" && slug ? `/tienda/${slug}/iniciar-sesion` : "/iniciar-sesion";
}

/**
 * Rutas privadas, literales porque Next analiza el matcher en el build. Una ruta privada nueva debe
 * agregarse aqui: `tests/auth/proxy.test.ts` falla si alguna de `src/app/(private)` o de `cuenta`
 * queda sin cubrir. `/catalogo` y `/catalogo/[id]` son el catalogo PUBLICO: solo se protegen sus
 * subrutas de backoffice.
 */
export const config = {
  matcher: [
    "/inicio/:path*",
    "/perfil/:path*",
    "/administracion/:path*",
    "/catalogo/categorias/:path*",
    "/catalogo/productos/:path*",
    "/catalogo/ubicaciones/:path*",
    "/catalogo/unidades/:path*",
    "/compras/:path*",
    "/inventario/:path*",
    "/logistica/:path*",
    "/pos/:path*",
    "/cuenta/:path*",
    "/tienda/:slug/cuenta/:path*",
  ],
};
