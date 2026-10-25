import { render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ element: null as unknown, init: null as unknown }));

// El render real de la imagen lo hace Next/Satori y se comprueba en el build; aqui se verifica lo
// que MARJYM le entrega: el contenido, el tamano y que sea estatica.
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: unknown, init: unknown) {
      captured.element = element;
      captured.init = init;
    }
  },
}));

import { GET, dynamic } from "@/app/(marketing)/og/route";
import { OG_IMAGE_PATH } from "@/modules/marketing/seo/marketingMetadata";

describe("imagen social (Open Graph)", () => {
  it("la ruta usa la convencion route.ts y se publica en /og (el grupo (marketing) no entra en la URL)", () => {
    const folder = join(process.cwd(), "src", "app", "(marketing)", "og");

    expect(existsSync(join(folder, "route.ts"))).toBe(true);
    expect(existsSync(join(folder, "route.tsx"))).toBe(false);
    expect(OG_IMAGE_PATH).toBe("/og");
  });

  it("se genera una sola vez en el build", () => {
    expect(dynamic).toBe("force-static");
  });

  it("mide 1200x630, el formato de Open Graph y Twitter", () => {
    GET();

    expect(captured.init).toEqual({ width: 1200, height: 630 });
  });

  it("reproduce la marca existente: la M, el nombre MARJYM y la descripcion del producto", () => {
    GET();
    render(captured.element as ReactElement);

    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("MARJYM")).toBeInTheDocument();
    expect(screen.getByText("Software de inventario, compras y punto de venta")).toBeInTheDocument();
  });

  it("no incluye cifras, clientes ni afirmaciones comerciales inventadas", () => {
    GET();
    const { container } = render(captured.element as ReactElement);

    expect(container.textContent).toBe("MMARJYMSoftware de inventario, compras y punto de venta");
  });
});
