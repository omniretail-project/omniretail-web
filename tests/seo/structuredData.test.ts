import { describe, expect, it } from "vitest";
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  serializeJsonLd,
} from "@/modules/marketing/seo/structuredData";

const site = new URL("https://marjym.com");
const FORBIDDEN = [
  "logo",
  "image",
  "telephone",
  "email",
  "address",
  "sameAs",
  "aggregateRating",
  "review",
  "offers",
  "priceRange",
  "potentialAction",
  "foundingDate",
  "numberOfEmployees",
];

describe("Organization", () => {
  const organization = buildOrganizationJsonLd(site);

  it("describe a MARJYM con su URL oficial", () => {
    expect(organization).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": "https://marjym.com/#organization",
      name: "MARJYM",
      url: "https://marjym.com/",
    });
  });

  it("solo incluye campos respaldados por el sitio, sin datos inventados", () => {
    expect(Object.keys(organization).sort()).toEqual(["@context", "@id", "@type", "description", "name", "url"]);
    for (const key of FORBIDDEN) expect(organization).not.toHaveProperty(key);
  });
});

describe("WebSite", () => {
  const website = buildWebSiteJsonLd(site);

  it("describe el sitio y lo enlaza con la organizacion", () => {
    expect(website).toMatchObject({
      "@type": "WebSite",
      "@id": "https://marjym.com/#website",
      name: "MARJYM",
      url: "https://marjym.com/",
      inLanguage: "es-GT",
      publisher: { "@id": "https://marjym.com/#organization" },
    });
  });

  it("no declara buscador (el sitio no tiene) ni otros campos inventados", () => {
    for (const key of FORBIDDEN) expect(website).not.toHaveProperty(key);
    expect(Object.keys(website).sort()).toEqual(["@context", "@id", "@type", "inLanguage", "name", "publisher", "url"]);
  });
});

describe("serializeJsonLd", () => {
  it("escapa < para que nada pueda cerrar la etiqueta script", () => {
    const serialized = serializeJsonLd({ name: "</script><img src=x onerror=alert(1)>" });

    expect(serialized).not.toContain("<");
    expect(serialized).toContain("\\u003c/script>");
  });

  it("sigue siendo JSON valido y recupera el valor original", () => {
    const data = { name: "</script>", nested: { a: 1 } };

    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});
