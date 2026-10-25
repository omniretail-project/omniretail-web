import { serializeJsonLd } from "@/modules/marketing/seo/structuredData";

/** Componente de servidor: emite un bloque JSON-LD ya serializado y escapado. */
export function JsonLd({ data }: Readonly<{ data: Record<string, unknown> }>) {
  return <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} type="application/ld+json" />;
}
