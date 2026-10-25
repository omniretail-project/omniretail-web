import { render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ element: null as unknown, init: null as unknown }));

// El render real del PNG lo hace Next/Satori (se comprueba en el build y con curl); aqui se verifica
// lo que MARJYM le entrega: tamano, formato e identidad visual.
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: unknown, init: unknown) {
      captured.element = element;
      captured.init = init;
    }
  },
}));

import Icon, { contentType, size } from "@/app/icon";

const root = process.cwd();

function tokenColor(name: string): string {
  const css = readFileSync(join(root, "src", "styles", "tokens.css"), "utf8");
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  return (match?.[1] ?? "").toLowerCase();
}

// Se leen los estilos del elemento React (no del DOM): jsdom descarta los degradados CSS.
function rootStyle(): Record<string, unknown> {
  return (captured.element as ReactElement<{ style: Record<string, unknown> }>).props.style;
}

describe("icono de la aplicacion (/icon)", () => {
  it("es un PNG de 96x96, multiplo de 48 como pide Google", () => {
    expect(contentType).toBe("image/png");
    expect(size).toEqual({ width: 96, height: 96 });
    expect(size.width % 48).toBe(0);

    Icon();
    expect(captured.init).toEqual({ width: 96, height: 96 });
  });

  it("dibuja la M blanca, sin otro texto", () => {
    Icon();
    const { container } = render(captured.element as ReactElement);

    expect(screen.getByText("M")).toBeInTheDocument();
    expect(container.textContent).toBe("M");
    expect(rootStyle().color).toBe("white");
  });

  it("usa el degradado del logotipo del login (BrandMark): structure -> primary", () => {
    Icon();
    const background = String(rootStyle().background).toLowerCase();

    expect(tokenColor("--color-structure")).toBe("#3e668f");
    expect(tokenColor("--color-primary")).toBe("#81a9ee");
    expect(background).toContain(tokenColor("--color-structure"));
    expect(background).toContain(tokenColor("--color-primary"));
  });
});

describe("favicon.ico convencional", () => {
  const faviconPath = join(root, "src", "app", "favicon.ico");

  it("sigue siendo el archivo src/app/favicon.ico, no un Route Handler", () => {
    expect(existsSync(faviconPath)).toBe(true);
    expect(existsSync(join(root, "src", "app", "favicon.ico", "route.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "app", "icon", "route.ts"))).toBe(false);
  });

  it("es un ICO valido con una imagen de 48x48 o mayor", () => {
    const bytes = readFileSync(faviconPath);
    const reserved = bytes.readUInt16LE(0);
    const type = bytes.readUInt16LE(2);
    const count = bytes.readUInt16LE(4);

    expect([reserved, type]).toEqual([0, 1]);
    expect(count).toBeGreaterThan(0);

    // Cada entrada del directorio mide 16 bytes; ancho 0 significa 256.
    const widths = Array.from({ length: count }, (_, index) => bytes[6 + index * 16] || 256);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(48);
  });

  it("no hay un segundo favicon en public/ que compita con el de src/app", () => {
    expect(existsSync(join(root, "public", "favicon.ico"))).toBe(false);
  });
});

describe("metadata de iconos", () => {
  it("el layout raiz no declara iconos propios: evita duplicar los de las convenciones de archivo", () => {
    const layout = readFileSync(join(root, "src", "app", "layout.tsx"), "utf8");

    expect(layout).not.toMatch(/\bicons\s*:/);
    expect(layout).not.toMatch(/favicon/i);
  });
});
