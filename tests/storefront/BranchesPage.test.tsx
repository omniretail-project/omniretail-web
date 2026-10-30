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

import { BranchesPage } from "@/modules/storefront/pages/BranchesPage";

describe("BranchesPage", () => {
  it("muestra todas las sucursales físicas disponibles con su código y datos de contacto", () => {
    state.loading = false;
    state.config = {
      branches: [
        {
          id: "b1",
          code: "CENTRO",
          name: "Sucursal Centro",
          address: "Zona 1, Guatemala",
          phone: "+502 2234-1000",
          email: "centro@ferrepharma.demo",
        },
        {
          id: "b2",
          code: "NORTE",
          name: "Sucursal Norte",
          address: "Zona 17, Guatemala",
          phone: "+502 2234-2000",
          email: "norte@ferrepharma.demo",
        },
      ],
    };

    render(<BranchesPage />);

    expect(screen.getByText("Nuestras sucursales")).toBeInTheDocument();

    // Sucursal Centro
    expect(screen.getByText("Sucursal Centro")).toBeInTheDocument();
    expect(screen.getByText("CENTRO")).toBeInTheDocument();
    expect(screen.getByText("Zona 1, Guatemala")).toBeInTheDocument();
    expect(screen.getByText("☎ +502 2234-1000")).toBeInTheDocument();
    expect(screen.getByText("✉ centro@ferrepharma.demo")).toBeInTheDocument();

    // Sucursal Norte
    expect(screen.getByText("Sucursal Norte")).toBeInTheDocument();
    expect(screen.getByText("NORTE")).toBeInTheDocument();
    expect(screen.getByText("Zona 17, Guatemala")).toBeInTheDocument();
    expect(screen.getByText("☎ +502 2234-2000")).toBeInTheDocument();
    expect(screen.getByText("✉ norte@ferrepharma.demo")).toBeInTheDocument();
  });

  it("muestra el mensaje de estado vacío actualizado cuando no hay sucursales activas", () => {
    state.loading = false;
    state.config = { branches: [] };

    render(<BranchesPage />);

    expect(screen.getByText("No hay sucursales activas disponibles.")).toBeInTheDocument();
  });

  it("muestra estado de carga mientras se recupera la información del tenant", () => {
    state.loading = true;
    state.config = null;

    render(<BranchesPage />);

    expect(screen.getByText("Cargando sucursales...")).toBeInTheDocument();
  });
});
