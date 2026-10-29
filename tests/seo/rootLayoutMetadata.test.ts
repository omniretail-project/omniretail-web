import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubCommercialSite } from "./seoEnv";

// next/font solo existe dentro del compilador de Next: aqui basta con el nombre de la variable CSS.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

// El layout solo usa estos dos proveedores al RENDERIZAR (envuelven a `children`). La metadata es un
// objeto estatico que se calcula al evaluar el modulo y no depende de ellos. Importar los reales cargaria
// toda la infraestructura de repositorios, lo que en una ejecucion completa (un worker por nucleo) hacia
// que esta prueba superara el timeout. Los dobles respetan los exports que el layout importa.
vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  RepositoryProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/shared/components/Toast", () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("metadata del layout raiz", () => {
  it("la aplicacion fuera de marketing no recibe plantilla de titulo ni metadata comercial", async () => {
    stubCommercialSite();
    // Cada archivo de prueba tiene su propio registro de modulos: se evalua una sola vez, sin resetModules.
    const root = (await import("@/app/layout")).metadata;

    expect(root.title).toBe("MARJYM");
    expect(root.alternates).toBeUndefined();
    expect(root.openGraph).toBeUndefined();
    expect(root.metadataBase).toBeUndefined();
    expect(String(root.description)).not.toMatch(/proyecto base/i);
  });
});
