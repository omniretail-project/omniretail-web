import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DemoPasswordRecoveryUnavailable } from "@/modules/auth/components/DemoPasswordRecoveryUnavailable";
import { DemoUnavailableNotice } from "@/shared/components/DemoUnavailableNotice";

describe("DemoUnavailableNotice", () => {
  it("usa el titulo por defecto y omite la descripcion vacia", () => {
    render(<DemoUnavailableNotice />);
    expect(screen.getByRole("region", { name: "No disponible en la demo" })).toBeInTheDocument();
  });

  it("muestra descripcion y contenido adicional", () => {
    render(
      <DemoUnavailableNotice description="Disponible en la versión contratada" title="Correo">
        <button type="button">Volver</button>
      </DemoUnavailableNotice>,
    );
    expect(screen.getByRole("region", { name: "Correo" })).toHaveTextContent(
      "Disponible en la versión contratada",
    );
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("la recuperacion de contrasena en la demo ofrece volver al login", () => {
    render(<DemoPasswordRecoveryUnavailable />);
    expect(screen.getByRole("link", { name: "Volver a iniciar sesión" })).toHaveAttribute(
      "href",
      "/iniciar-sesion",
    );
  });
});
