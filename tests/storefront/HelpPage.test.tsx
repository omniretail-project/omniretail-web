import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PublicStorefrontConfigDto } from "@/modules/storefront/application/dto/PublicStorefrontConfigDto";

const state = vi.hoisted(() => ({
  config: null as Partial<PublicStorefrontConfigDto> | null,
  loading: false,
}));

vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => ({ config: state.config, loading: state.loading }),
}));

import { HelpPage } from "@/modules/storefront/pages/HelpPage";

describe("HelpPage", () => {
  it("muestra el contacto público de la tienda y sus sucursales a cualquier visitante", () => {
    state.loading = false;
    state.config = {
      contactPhone: "+502 2222-3333",
      contactEmail: "ventas@ferrepharma.demo",
      branches: [
        { id: "b1", name: "Centro" },
        { id: "b2", name: "Norte" },
      ],
    };

    render(<HelpPage />);

    expect(screen.getByText("+502 2222-3333")).toBeInTheDocument();
    expect(screen.getByText("ventas@ferrepharma.demo")).toBeInTheDocument();
    expect(screen.getByText("2 sucursales activas")).toBeInTheDocument();
  });

  it("indica lo que el negocio no ha configurado", () => {
    state.loading = false;
    state.config = { branches: [{ id: "b1", name: "Centro" }] };

    render(<HelpPage />);

    expect(screen.getAllByText("Información aún no configurada")).toHaveLength(2);
    expect(screen.getByText("1 sucursal activa")).toBeInTheDocument();
  });

  it("muestra el estado de carga y, sin tienda, no inventa datos", () => {
    state.loading = true;
    state.config = null;
    const { unmount } = render(<HelpPage />);
    expect(screen.getAllByText("Cargando información...")).toHaveLength(3);
    unmount();

    state.loading = false;
    render(<HelpPage />);
    expect(screen.getAllByText("Información aún no configurada")).toHaveLength(3);
  });
});
