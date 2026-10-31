import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LandingNavbar from "@/modules/marketing/components/LandingNavbar";

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderNavbar() {
  const { container } = render(<LandingNavbar />);
  const header = container.querySelector("header");
  if (!header) throw new Error("LandingNavbar debe renderizar un <header>");
  return header;
}

const SECONDARY_BUTTON_CLASSES = [
  "border",
  "border-[var(--mkt-accent)]",
  "text-[var(--mkt-primary)]",
  "hover:bg-[var(--mkt-accent-light)]",
  "focus-visible:outline-2",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-[var(--mkt-accent)]",
];

describe("LandingNavbar: rutas", () => {
  it("conserva el destino de cada enlace de navegacion", () => {
    renderNavbar();

    const anchors: Array<[string, string]> = [
      ["Funcionalidades", "/#funcionalidades"],
      ["Módulos", "/#modulos"],
      ["Cómo funciona", "/#como-funciona"],
      ["Planes", "/#precios"],
      ["FAQ", "/#faq"],
    ];
    for (const [label, href] of anchors) {
      for (const link of screen.getAllByRole("link", { name: label })) {
        expect(link).toHaveAttribute("href", href);
      }
    }
    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/");
  });

  it("mantiene «Iniciar sesión» y «Solicitar información» en escritorio y en el menu movil", () => {
    renderNavbar();

    const login = screen.getAllByRole("link", { name: "Iniciar sesión" });
    expect(login).toHaveLength(2);
    login.forEach((link) => expect(link).toHaveAttribute("href", "/iniciar-sesion"));

    const cta = screen.getAllByRole("link", { name: "Solicitar información" });
    expect(cta).toHaveLength(2);
    cta.forEach((link) => expect(link).toHaveAttribute("href", "/solicitar-informacion"));
  });

  it("sigue mostrando «Probar demo» en ambas posiciones cuando hay demo configurada", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_URL", "https://demo.marjym.example");
    renderNavbar();

    const demo = screen.getAllByRole("link", { name: "Probar demo" });
    expect(demo).toHaveLength(2);
    demo.forEach((link) => expect(link).toHaveAttribute("href", "https://demo.marjym.example/iniciar-sesion"));
  });
});

describe("LandingNavbar: estilo del encabezado", () => {
  it("usa fondo blanco al 95 %, borde azul claro y sombra sutil, conservando sticky y blur", () => {
    const header = renderNavbar();

    expect(header).toHaveClass(
      "sticky",
      "top-0",
      "backdrop-blur-xl",
      "border-b",
      "bg-[var(--mkt-surface)]/95",
      "border-[var(--mkt-border-light)]",
      "shadow-sm",
    );
    expect(header.className).not.toContain("rgba(255,244,214");
  });

  it("presenta «Iniciar sesión» como boton secundario accesible en escritorio y en movil", () => {
    renderNavbar();

    const [desktop, mobile] = screen.getAllByRole("link", { name: "Iniciar sesión" });
    expect(desktop).toHaveClass(...SECONDARY_BUTTON_CLASSES, "inline-flex", "min-h-11", "rounded-md");
    expect(mobile).toHaveClass(...SECONDARY_BUTTON_CLASSES, "rounded-md", "text-center", "md:hidden");
    for (const link of [desktop, mobile]) {
      expect(link).not.toHaveClass("bg-[var(--mkt-accent)]", "text-white");
    }
  });

  it("mantiene «Solicitar información» como CTA principal azul", () => {
    renderNavbar();

    for (const link of screen.getAllByRole("link", { name: "Solicitar información" })) {
      expect(link).toHaveClass("bg-[var(--mkt-accent)]", "text-white");
    }
  });
});
