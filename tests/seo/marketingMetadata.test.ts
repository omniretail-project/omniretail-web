import type { Metadata } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INFORMATION_REQUEST_DESCRIPTION,
  INFORMATION_REQUEST_TITLE,
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  OG_IMAGE_PATH,
  buildMarketingMetadata,
} from "@/modules/marketing/seo/marketingMetadata";
import { stubClientInstall, stubCommercialSite, stubNoSiteUrl, stubPublicDemo, stubSiteEnv } from "./seoEnv";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function landing(): Metadata {
  return buildMarketingMetadata({
    title: { absolute: LANDING_TITLE },
    socialTitle: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    path: "/",
  });
}

function informationRequest(): Metadata {
  return buildMarketingMetadata({
    title: INFORMATION_REQUEST_TITLE,
    socialTitle: `${INFORMATION_REQUEST_TITLE} | MARJYM`,
    description: INFORMATION_REQUEST_DESCRIPTION,
    path: "/solicitar-informacion",
  });
}

describe("textos comerciales", () => {
  it("el titulo y la descripcion de la landing son los autorizados", () => {
    expect(LANDING_TITLE).toBe("MARJYM | Software de inventario, compras y punto de venta");
    expect(LANDING_DESCRIPTION).toBe(
      "MARJYM es un software en la nube para gestionar inventario, compras, recepciones, punto de venta y sucursales de ferreterías, farmacias y comercios en Guatemala.",
    );
  });

  it("describen un software empresarial y mencionan sus funciones reales", () => {
    for (const term of ["software", "inventario", "compras", "punto de venta", "sucursales", "Guatemala"]) {
      expect(`${LANDING_TITLE} ${LANDING_DESCRIPTION}`.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it("el titulo de solicitar informacion no repite la marca (la plantilla del layout la agrega)", () => {
    expect(INFORMATION_REQUEST_TITLE).not.toMatch(/marjym/i);
  });
});

describe("buildMarketingMetadata en el sitio comercial oficial", () => {
  it("la landing tiene su propio canonical y un titulo absoluto que ignora la plantilla", () => {
    stubCommercialSite();
    const metadata = landing();

    expect(metadata.title).toEqual({ absolute: LANDING_TITLE });
    expect(metadata.description).toBe(LANDING_DESCRIPTION);
    expect(metadata.alternates?.canonical).toBe("https://marjym.com/");
  });

  it("solicitar-informacion tiene su canonical propio, distinto de la portada", () => {
    stubCommercialSite();
    const metadata = informationRequest();

    expect(metadata.alternates?.canonical).toBe("https://marjym.com/solicitar-informacion");
    expect(metadata.alternates?.canonical).not.toBe(landing().alternates?.canonical);
  });

  it("Open Graph: sitio web en es_GT, con la URL de la propia pagina y la imagen de MARJYM", () => {
    stubCommercialSite();
    const og = landing().openGraph as unknown as {
      type: string;
      siteName: string;
      locale: string;
      url: string;
      title: string;
      images: Array<{ url: string; width: number; height: number; alt: string }>;
    };

    expect(og).toMatchObject({
      type: "website",
      siteName: "MARJYM",
      locale: "es_GT",
      url: "https://marjym.com/",
      title: LANDING_TITLE,
    });
    expect(og.images[0]).toMatchObject({ url: `https://marjym.com${OG_IMAGE_PATH}`, width: 1200, height: 630 });
    expect(og.images[0].alt).toBeTruthy();
  });

  it("Open Graph de solicitar-informacion no hereda la URL ni el titulo de la landing", () => {
    stubCommercialSite();
    const og = informationRequest().openGraph as unknown as {
      url: string;
      title: string;
      description: string;
    };

    expect(og.url).toBe("https://marjym.com/solicitar-informacion");
    expect(og.title).toBe("Solicitar información | MARJYM");
    expect(og.description).toBe(INFORMATION_REQUEST_DESCRIPTION);
  });

  it("Twitter Card grande con la misma imagen", () => {
    stubCommercialSite();
    const twitter = landing().twitter as unknown as { card: string; title: string; images: string[] };

    expect(twitter.card).toBe("summary_large_image");
    expect(twitter.title).toBe(LANDING_TITLE);
    expect(twitter.images).toEqual(["https://marjym.com/og"]);
  });

  it("el nombre de la marca no se duplica en el titulo social de la landing", () => {
    stubCommercialSite();
    const og = landing().openGraph as unknown as { title: string };

    expect(og.title.match(/MARJYM/g)).toHaveLength(1);
  });
});

describe("buildMarketingMetadata fuera del sitio comercial", () => {
  it("en la instalacion de un cliente solo deja titulo y descripcion: sin canonical ni Open Graph de MARJYM", () => {
    stubClientInstall();
    const metadata = landing();

    expect(metadata.title).toEqual({ absolute: LANDING_TITLE });
    expect(metadata.description).toBe(LANDING_DESCRIPTION);
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
  });

  it("sin NEXT_PUBLIC_SITE_URL no se atribuye a ningun cliente el dominio de MARJYM", () => {
    stubNoSiteUrl();
    const metadata = landing();

    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
  });

  it.each(["marjym.com", "https://marjym.com/landing", "https://www.marjym.com", "http://marjym.com"])(
    "con la URL invalida %s tampoco hay canonical ni Open Graph",
    (site) => {
      stubSiteEnv({ site });
      const metadata = informationRequest();

      expect(metadata.alternates).toBeUndefined();
      expect(metadata.openGraph).toBeUndefined();
      expect(metadata.twitter).toBeUndefined();
    },
  );

  it("en la demo publica tampoco, aunque tenga la URL oficial", () => {
    stubPublicDemo("https://marjym.com");
    const metadata = informationRequest();

    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
  });
});

describe("metadata de las rutas de marketing", () => {
  async function load() {
    vi.resetModules();
    const layout = await import("@/app/(marketing)/layout");
    const page = await import("@/app/(marketing)/page");
    const info = await import("@/app/(marketing)/solicitar-informacion/page");
    return { layout: layout.metadata, page: page.metadata, info: info.metadata };
  }

  it("el layout solo define la base: metadataBase, plantilla de titulo y descripcion", async () => {
    stubCommercialSite();
    const { layout } = await load();

    expect(String(layout.metadataBase)).toBe("https://marjym.com/");
    expect(layout.title).toEqual({ default: LANDING_TITLE, template: "%s | MARJYM" });
    expect(layout.description).toBe(LANDING_DESCRIPTION);
  });

  it("el layout NO define canonical ni Open Graph: no pueden heredarse a otras paginas", async () => {
    stubCommercialSite();
    const { layout } = await load();

    expect(layout.alternates).toBeUndefined();
    expect(layout.openGraph).toBeUndefined();
    expect(layout.twitter).toBeUndefined();
  });

  it("cada pagina declara su propio canonical", async () => {
    stubCommercialSite();
    const { page, info } = await load();

    expect(page.alternates?.canonical).toBe("https://marjym.com/");
    expect(info.alternates?.canonical).toBe("https://marjym.com/solicitar-informacion");
    expect(info.title).toBe("Solicitar información");
  });

  it("en la instalacion de un cliente el layout no fija metadataBase ni hay canonical", async () => {
    stubClientInstall();
    const { layout, page, info } = await load();

    expect(layout.metadataBase).toBeUndefined();
    expect(page.alternates).toBeUndefined();
    expect(info.alternates).toBeUndefined();
  });
});
