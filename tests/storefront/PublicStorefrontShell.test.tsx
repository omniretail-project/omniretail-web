import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integracion REAL de PublicStorefrontShell + StorefrontFloatingCart: el acceso flotante se monta
 * una sola vez, dentro del shell correcto, y respeta las reglas de visibilidad y navegacion. Solo se
 * simulan el encabezado/pie (fuera del alcance), el carrito, el toast, las rutas y la ruta actual.
 */
const state = vi.hoisted(() => ({
  base: "",
  itemCount: 0,
  pathname: "/catalogo",
  scrollY: 0,
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a"> & { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/modules/storefront/providers/StorefrontCartProvider", () => ({
  useStorefrontCart: () => ({ itemCount: state.itemCount }),
}));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ toasts: [] }) }));
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({
  useStorefrontRoutes: () => ({
    home: () => state.base || "/",
    catalog: () => `${state.base}/catalogo`,
    offers: () => `${state.base}/ofertas`,
    cart: () => `${state.base}/carrito`,
    checkout: () => `${state.base}/checkout`,
    confirmation: () => `${state.base}/pedido/confirmacion`,
    account: () => `${state.base}/cuenta`,
    branches: () => `${state.base}/sucursales`,
    help: () => `${state.base}/ayuda`,
  }),
}));
vi.mock("@/modules/storefront/components/StorefrontHeader", () => ({
  StorefrontHeader: () => <header>encabezado de la tienda</header>,
}));
vi.mock("@/modules/storefront/components/StorefrontFooter", () => ({
  StorefrontFooter: () => <footer>pie de la tienda</footer>,
}));

import { PublicStorefrontShell } from "@/modules/storefront/components/PublicStorefrontShell";

function scrollTo(value: number) {
  state.scrollY = value;
  fireEvent.scroll(window);
}

beforeEach(() => {
  state.base = "";
  state.itemCount = 2;
  state.pathname = "/catalogo";
  state.scrollY = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => state.scrollY });
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => 800 });
});

describe("PublicStorefrontShell with the floating cart", () => {
  it("mounts exactly one floating cart in the storefront shell, between the content and the footer", () => {
    scrollTo(500);
    render(
      <PublicStorefrontShell>
        <main>contenido de la pagina</main>
      </PublicStorefrontShell>,
    );

    expect(screen.getAllByTestId("storefront-floating-cart")).toHaveLength(1);
    expect(screen.getByText("encabezado de la tienda")).toBeInTheDocument();
    expect(screen.getByText("pie de la tienda")).toBeInTheDocument();
    const cart = screen.getByTestId("storefront-floating-cart");
    const content = screen.getByText("contenido de la pagina");
    const footer = screen.getByText("pie de la tienda");
    expect(content.compareDocumentPosition(cart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cart.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not duplicate the floating cart across re-renders", () => {
    scrollTo(500);
    const { rerender } = render(
      <PublicStorefrontShell>
        <main>uno</main>
      </PublicStorefrontShell>,
    );
    rerender(
      <PublicStorefrontShell>
        <main>dos</main>
      </PublicStorefrontShell>,
    );

    expect(screen.getAllByTestId("storefront-floating-cart")).toHaveLength(1);
  });

  it("hides the floating cart from print, like the rest of the storefront chrome", () => {
    render(
      <PublicStorefrontShell>
        <main>contenido</main>
      </PublicStorefrontShell>,
    );

    expect(screen.getByTestId("storefront-floating-cart").parentElement).toHaveClass("print:hidden");
  });

  it("links to the cart of the current storefront, including a tenant's own base path", () => {
    state.base = "/tienda/ferreteria";
    state.pathname = "/tienda/ferreteria/catalogo";
    scrollTo(500);
    render(
      <PublicStorefrontShell>
        <main>contenido</main>
      </PublicStorefrontShell>,
    );

    expect(screen.getByRole("link", { name: "Ver carrito, 2 artículos" })).toHaveAttribute(
      "href",
      "/tienda/ferreteria/carrito",
    );
  });

  it("is not rendered when the cart is empty, but the rest of the shell stays", () => {
    state.itemCount = 0;
    scrollTo(500);
    render(
      <PublicStorefrontShell>
        <main>contenido</main>
      </PublicStorefrontShell>,
    );

    expect(screen.queryByTestId("storefront-floating-cart")).toBeNull();
    expect(screen.getByText("encabezado de la tienda")).toBeInTheDocument();
  });

  it.each(["/checkout", "/carrito", "/pedido/confirmacion"])(
    "is not rendered on %s, where the shopper is already finishing the purchase",
    (pathname) => {
      state.pathname = pathname;
      scrollTo(500);
      render(
        <PublicStorefrontShell>
          <main>contenido</main>
        </PublicStorefrontShell>,
      );

      expect(screen.queryByTestId("storefront-floating-cart")).toBeNull();
    },
  );

  it("stays hidden from assistive technology and the tab order until the shopper scrolls", () => {
    render(
      <PublicStorefrontShell>
        <main>contenido</main>
      </PublicStorefrontShell>,
    );

    const cart = screen.getByTestId("storefront-floating-cart");
    expect(cart).toHaveAttribute("aria-hidden", "true");
    expect(cart).toHaveAttribute("tabindex", "-1");

    scrollTo(500);

    expect(screen.getByTestId("storefront-floating-cart")).toHaveAttribute("aria-hidden", "false");
  });

  it.each(["/cuenta", "/cuenta/pedidos", "/cuenta/perfil"])(
    "leaves My Account (%s) with its own chrome: no storefront header, footer or floating cart",
    (pathname) => {
      state.pathname = pathname;
      scrollTo(500);
      render(
        <PublicStorefrontShell>
          <main>mi cuenta</main>
        </PublicStorefrontShell>,
      );

      expect(screen.getByText("mi cuenta")).toBeInTheDocument();
      expect(screen.queryByTestId("storefront-floating-cart")).toBeNull();
      expect(screen.queryByText("encabezado de la tienda")).toBeNull();
      expect(screen.queryByText("pie de la tienda")).toBeNull();
    },
  );
});

describe("where the shell is mounted", () => {
  const root = process.cwd();
  const read = (path: string) => readFileSync(join(root, path), "utf8");

  it.each(["src/app/(public)/layout.tsx", "src/app/tienda/[tenantSlug]/layout.tsx"])(
    "%s mounts the shell once and never mounts the floating cart on its own",
    (layout) => {
      const source = read(layout);

      expect(source.match(/<PublicStorefrontShell>/g)).toHaveLength(1);
      expect(source).not.toContain("StorefrontFloatingCart");
    },
  );

  it("only the shell mounts the floating cart", () => {
    const shell = read("src/modules/storefront/components/PublicStorefrontShell.tsx");

    expect(shell.match(/<StorefrontFloatingCart \/>/g)).toHaveLength(1);
  });
});
