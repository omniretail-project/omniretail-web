import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  base: "",
  itemCount: 0,
  pathname: "/catalogo",
  scrollY: 0,
  toastCount: 0,
  viewportHeight: 800,
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
vi.mock("@/shared/components/Toast", () => ({
  useToast: () => ({ toasts: Array.from({ length: state.toastCount }) }),
}));
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

import { StorefrontFloatingCart } from "@/modules/storefront/components/StorefrontFloatingCart";

function setScrollY(value: number) {
  state.scrollY = value;
  fireEvent.scroll(window);
}

beforeEach(() => {
  state.base = "";
  state.itemCount = 0;
  state.pathname = "/catalogo";
  state.scrollY = 0;
  state.toastCount = 0;
  state.viewportHeight = 800;

  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => state.scrollY,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    get: () => state.viewportHeight,
  });
});

describe("StorefrontFloatingCart", () => {
  it("no renderiza nada cuando el carrito está vacío", () => {
    setScrollY(500);
    render(<StorefrontFloatingCart />);

    expect(screen.queryByTestId("storefront-floating-cart")).not.toBeInTheDocument();
  });

  it("aparece al descender, se oculta al volver arriba y evita parpadeos cerca del umbral", () => {
    state.itemCount = 1;
    render(<StorefrontFloatingCart />);

    expect(screen.queryByRole("link", { name: "Ver carrito, 1 artículo" })).not.toBeInTheDocument();

    setScrollY(320);
    const link = screen.getByRole("link", { name: "Ver carrito, 1 artículo" });
    expect(link).toHaveClass("opacity-100");

    setScrollY(280);
    expect(screen.getByRole("link", { name: "Ver carrito, 1 artículo" })).toBeInTheDocument();

    setScrollY(200);
    expect(screen.queryByRole("link", { name: "Ver carrito, 1 artículo" })).not.toBeInTheDocument();
    expect(screen.getByTestId("storefront-floating-cart")).toHaveClass("opacity-0");
  });

  it("refleja el total de unidades y reacciona a incrementos y a la eliminación final", () => {
    state.itemCount = 4;
    state.scrollY = 400;
    const view = render(<StorefrontFloatingCart />);

    expect(screen.getByRole("link", { name: "Ver carrito, 4 artículos" })).toHaveTextContent("4");

    state.itemCount = 104;
    view.rerender(<StorefrontFloatingCart />);
    expect(screen.getByRole("link", { name: "Ver carrito, 104 artículos" })).toHaveTextContent(
      "104",
    );

    state.itemCount = 0;
    view.rerender(<StorefrontFloatingCart />);
    expect(screen.queryByTestId("storefront-floating-cart")).not.toBeInTheDocument();
  });

  it("navega al carrito resuelto por las rutas normales y con prefijo de tenant", () => {
    state.itemCount = 2;
    state.scrollY = 400;
    const view = render(<StorefrontFloatingCart />);

    expect(screen.getByRole("link", { name: "Ver carrito, 2 artículos" })).toHaveAttribute(
      "href",
      "/carrito",
    );

    state.base = "/tienda/ferreteria";
    state.pathname = "/tienda/ferreteria/catalogo/product-1";
    view.rerender(<StorefrontFloatingCart />);
    expect(screen.getByRole("link", { name: "Ver carrito, 2 artículos" })).toHaveAttribute(
      "href",
      "/tienda/ferreteria/carrito",
    );
  });

  it.each([
    "/carrito",
    "/checkout",
    "/pedido/confirmacion",
    "/pedido/confirmacion/TRK-1",
    "/cuenta",
    "/cuenta/pedidos",
  ])("se excluye de %s", (pathname) => {
    state.itemCount = 3;
    state.pathname = pathname;
    state.scrollY = 400;

    render(<StorefrontFloatingCart />);

    expect(screen.queryByTestId("storefront-floating-cart")).not.toBeInTheDocument();
  });

  it.each([
    "/tienda/ferreteria/carrito",
    "/tienda/ferreteria/checkout",
    "/tienda/ferreteria/pedido/confirmacion/TRK-1",
    "/tienda/ferreteria/cuenta/perfil",
  ])("se excluye de la ruta tenant %s", (pathname) => {
    state.base = "/tienda/ferreteria";
    state.itemCount = 3;
    state.pathname = pathname;
    state.scrollY = 400;

    render(<StorefrontFloatingCart />);

    expect(screen.queryByTestId("storefront-floating-cart")).not.toBeInTheDocument();
  });

  it("recalcula la visibilidad en cambios de ruta y viewport", () => {
    state.itemCount = 2;
    state.scrollY = 400;
    const view = render(<StorefrontFloatingCart />);
    expect(screen.getByRole("link", { name: "Ver carrito, 2 artículos" })).toBeInTheDocument();

    state.pathname = "/ofertas";
    state.scrollY = 0;
    view.rerender(<StorefrontFloatingCart />);
    expect(
      screen.queryByRole("link", { name: "Ver carrito, 2 artículos" }),
    ).not.toBeInTheDocument();

    state.viewportHeight = 500;
    state.scrollY = 250;
    fireEvent.resize(window);
    expect(screen.getByRole("link", { name: "Ver carrito, 2 artículos" })).toBeInTheDocument();
  });

  it("limpia los listeners de scroll y resize al desmontarse", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");

    const view = render(<StorefrontFloatingCart />);
    const scrollHandler = addEventListener.mock.calls.find(([event]) => event === "scroll")?.[1];
    const resizeHandler = addEventListener.mock.calls.find(([event]) => event === "resize")?.[1];

    view.unmount();

    expect(scrollHandler).toBeTypeOf("function");
    expect(resizeHandler).toBeTypeOf("function");
    expect(removeEventListener).toHaveBeenCalledWith("scroll", scrollHandler);
    expect(removeEventListener).toHaveBeenCalledWith("resize", resizeHandler);
  });

  it("mantiene icono y badge decorativos sin anuncios accesibles redundantes", () => {
    state.itemCount = 3;
    state.scrollY = 400;
    render(<StorefrontFloatingCart />);

    const link = screen.getByRole("link", { name: "Ver carrito, 3 artículos" });
    expect(link).toHaveAttribute("href", "/carrito");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(link.querySelector("span")).toHaveAttribute("aria-hidden", "true");
  });

  it("se aparta del área reservada para los toasts mientras haya uno visible", () => {
    state.itemCount = 3;
    state.scrollY = 400;
    state.toastCount = 1;
    render(<StorefrontFloatingCart />);

    expect(screen.getByRole("link", { name: "Ver carrito, 3 artículos" })).toHaveClass(
      "bottom-[calc(8rem+env(safe-area-inset-bottom))]",
      "sm:right-[26rem]",
    );
  });
});
