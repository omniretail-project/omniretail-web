import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), usePathname: () => "/" }));

import MarketingLayout from "@/app/(marketing)/layout";
import MarketingPage from "@/app/(marketing)/page";
import LandingFeatures from "@/modules/marketing/components/LandingFeatures";
import LandingHero from "@/modules/marketing/components/LandingHero";
import { stubClientInstall, stubCommercialSite, stubNoSiteUrl, stubPublicDemo, stubSiteEnv } from "./seoEnv";

afterEach(() => {
  vi.unstubAllEnvs();
});

function jsonLdBlocks(container: HTMLElement) {
  return [...container.querySelectorAll('script[type="application/ld+json"]')].map(
    (script) => JSON.parse(script.textContent ?? "{}") as Record<string, unknown>,
  );
}

describe("datos estructurados de la landing", () => {
  it("el sitio comercial emite Organization y WebSite", () => {
    stubCommercialSite();

    const { container } = render(<MarketingPage />);

    expect(jsonLdBlocks(container).map((block) => block["@type"])).toEqual(["Organization", "WebSite"]);
  });

  it("una instalacion de cliente no emite datos estructurados de MARJYM", () => {
    stubClientInstall();

    const { container } = render(<MarketingPage />);

    expect(jsonLdBlocks(container)).toEqual([]);
  });

  it("sin la variable comercial, con una URL invalida o en la demo no hay datos estructurados", () => {
    stubNoSiteUrl();
    expect(jsonLdBlocks(render(<MarketingPage />).container)).toEqual([]);

    stubSiteEnv({ site: "https://marjym.com/landing" });
    expect(jsonLdBlocks(render(<MarketingPage />).container)).toEqual([]);

    stubPublicDemo("https://marjym.com");
    expect(jsonLdBlocks(render(<MarketingPage />).container)).toEqual([]);
  });
});

describe("layout de marketing", () => {
  it("envuelve el contenido con la navegacion y el pie de la landing", () => {
    render(
      <MarketingLayout>
        <p>contenido de la pagina</p>
      </MarketingLayout>,
    );

    expect(screen.getByRole("main")).toHaveTextContent("contenido de la pagina");
    expect(screen.getAllByText("MARJYM").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole("link", { name: "Solicitar información" }).length).toBeGreaterThan(0);
  });
});

describe("hero", () => {
  it("tiene un unico H1 accesible y describe a MARJYM como software", () => {
    render(<LandingHero />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/MARJYM es un software en la nube/)).toBeInTheDocument();
  });

  it("oculta a la tecnologia de asistencia solo la ilustracion decorativa con datos de ejemplo", () => {
    const { container } = render(<LandingHero />);
    const decorative = container.querySelector('[aria-hidden="true"]') as HTMLElement;

    expect(within(decorative).getByText("Resumen de Organización")).toBeInTheDocument();
    expect(decorative.querySelector("a, button, input")).toBeNull();
    expect(screen.getByRole("link", { name: "Solicitar información" })).toBeInTheDocument();
  });
});

describe("negocios de ejemplo", () => {
  it("«Ferretería Los Altos» y «Farmacia La Salud» se rotulan como ejemplos ilustrativos", () => {
    render(<LandingFeatures />);

    expect(screen.getByText("Ferretería Los Altos")).toBeInTheDocument();
    expect(screen.getByText("Farmacia La Salud")).toBeInTheDocument();
    expect(screen.getAllByText("Ejemplo ilustrativo")).toHaveLength(2);
  });
});
