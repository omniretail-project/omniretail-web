import { renderOgImage } from "@/modules/marketing/seo/ogImage";

// Imagen estatica: se genera en el build, no en cada visita. Se publica en `/og` (el grupo
// `(marketing)` no forma parte de la URL). Es un Route Handler y no `opengraph-image.tsx` a
// proposito: esa convencion agregaria la etiqueta og:image en TODOS los builds (tambien en las
// instalaciones de clientes); asi solo la referencia la metadata del sitio comercial oficial.
export const dynamic = "force-static";

export function GET() {
  return renderOgImage();
}
