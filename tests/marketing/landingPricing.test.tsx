import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), usePathname: () => "/" }));

import MarketingPage from "@/app/(marketing)/page";
import { BASE_MONTHLY_QUETZALES, SUBSCRIPTION_ADDONS } from "@/core/subscription/catalog";
import LandingFaq from "@/modules/marketing/components/LandingFaq";
import LandingFooter from "@/modules/marketing/components/LandingFooter";
import LandingNavbar from "@/modules/marketing/components/LandingNavbar";
import LandingPricing from "@/modules/marketing/components/LandingPricing";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Importes de suscripcion que ya no deben mostrarse: Q199, Q129 y Q99 (con o sin espacio). */
const SUBSCRIPTION_PRICE = /Q\s?(199|129|99)(?![\d.,])/;

describe("seccion de planes de la landing", () => {
  it("presenta los planes sin tarifas: titulo, subtitulo y cotizacion personalizada", () => {
    render(<LandingPricing />);

    expect(screen.getByRole("heading", { level: 2, name: "Planes y soluciones para tu negocio" })).toBeInTheDocument();
    expect(screen.queryByText(/Precios simples y transparentes/)).not.toBeInTheDocument();
    expect(screen.getByText(/propuesta personalizada/)).toBeInTheDocument();
    expect(screen.getByText("Cotización personalizada")).toBeInTheDocument();
    expect(screen.getAllByText("Precio bajo cotización")).toHaveLength(SUBSCRIPTION_ADDONS.length);
  });

  it("no muestra Q199, Q129 ni Q99 ni la periodicidad mensual", () => {
    const { container } = render(<LandingPricing />);

    expect(container.textContent).not.toMatch(SUBSCRIPTION_PRICE);
    expect(container.textContent).not.toMatch(/\/\s*mes/);
  });

  it("conserva las funcionalidades de la base y los modulos complementarios", () => {
    render(<LandingPricing />);

    for (const feature of ["Inventario", "Compras", "Recepciones", "Punto de Venta", "Lotes", "Vencimientos", "Números de serie"]) {
      expect(screen.getByText(feature)).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "MARJYM Base" })).toBeInTheDocument();
    for (const addon of SUBSCRIPTION_ADDONS) {
      expect(screen.getByRole("heading", { name: addon.name })).toBeInTheDocument();
    }
    expect(screen.getByText(/Incluye catálogo en línea, carrito de compras/)).toBeInTheDocument();
    expect(screen.getByText(SUBSCRIPTION_ADDONS[1].description)).toBeInTheDocument();
  });

  it("mantiene id=precios y el boton que lleva al formulario de solicitud", () => {
    const { container } = render(<LandingPricing />);

    expect(container.querySelector("section#precios")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Solicitar una propuesta" })).toHaveAttribute("href", "/solicitar-informacion");
  });
});

describe("navegacion hacia los planes", () => {
  it("el menu muestra «Planes» y sigue apuntando a /#precios", () => {
    render(<LandingNavbar />);

    expect(screen.queryByRole("link", { name: "Precios" })).not.toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "Planes" })) {
      expect(link).toHaveAttribute("href", "/#precios");
    }
  });

  it("el pie muestra «Planes» y sigue apuntando a /#precios", () => {
    render(<LandingFooter />);

    expect(screen.queryByRole("link", { name: "Precios" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planes" })).toHaveAttribute("href", "/#precios");
  });
});

describe("preguntas frecuentes", () => {
  it("incluye la pregunta de costo con la respuesta aprobada", () => {
    render(<LandingFaq />);

    expect(screen.getByText("¿Cuánto cuesta implementar MARJYM?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "El costo depende de las necesidades de tu negocio, los módulos requeridos y el alcance de la implementación. Solicita información y prepararemos una propuesta personalizada.",
      ),
    ).toBeInTheDocument();
  });

  it("no promete condiciones comerciales sin confirmar", () => {
    const { container } = render(<LandingFaq />);

    expect(container.textContent).not.toMatch(/sin costo adicional|gratis|gratuit|promoci|precio fijo/i);
    expect(container.textContent).not.toMatch(SUBSCRIPTION_PRICE);
  });

  it("conserva la explicacion de lotes, vencimientos y series", () => {
    render(<LandingFaq />);

    expect(screen.getByText(/lotes, fechas de vencimiento y números de serie/)).toBeInTheDocument();
  });
});

describe("pagina completa de la landing", () => {
  it("no contiene tarifas de suscripcion en ninguna seccion y conserva sus secciones", () => {
    const { container } = render(<MarketingPage />);

    expect(container.textContent).not.toMatch(SUBSCRIPTION_PRICE);
    expect(container.querySelector("#precios")).not.toBeNull();
    expect(container.querySelector("#faq")).not.toBeNull();
    expect(container.querySelector("#funcionalidades")).not.toBeNull();
    const section = container.querySelector("#precios") as HTMLElement;
    expect(within(section).getByRole("link", { name: "Solicitar una propuesta" })).toHaveAttribute(
      "href",
      "/solicitar-informacion",
    );
  });
});

describe("catalogo de suscripcion del dominio", () => {
  it("no cambia: los importes internos siguen siendo los mismos", () => {
    expect(BASE_MONTHLY_QUETZALES).toBe(199);
    expect(Object.fromEntries(SUBSCRIPTION_ADDONS.map((addon) => [addon.code, addon.monthlyQuetzales]))).toEqual({
      ecommerce_delivery: 129,
      advanced_reports: 99,
    });
  });
});
