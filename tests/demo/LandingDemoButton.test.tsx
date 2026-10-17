import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LandingHero from "@/modules/marketing/components/LandingHero";
import LandingNavbar from "@/modules/marketing/components/LandingNavbar";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("landing demo button", () => {
  it("is hidden when the demo URL is empty", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_URL", "");
    render(<LandingHero />);
    render(<LandingNavbar />);
    expect(screen.queryByText("Probar demo")).not.toBeInTheDocument();
  });

  it("links externally to the demo login when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_URL", "https://demo.marjym.example/");
    render(<LandingHero />);
    const link = screen.getByText("Probar demo");
    expect(link).toHaveAttribute("href", "https://demo.marjym.example/iniciar-sesion");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders desktop and mobile entries in the navbar", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_URL", "https://demo.marjym.example");
    render(<LandingNavbar />);
    expect(screen.getAllByText("Probar demo")).toHaveLength(2);
  });
});
