import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`PERMANENT:${url}`);
  }),
}));

vi.mock("next/navigation", () => nav);

import InformationRoute from "@/app/(marketing)/solicitar-informacion/page";
import ContractRoute from "@/app/contratar/page";

afterEach(() => {
  vi.unstubAllEnvs();
  nav.redirect.mockClear();
  nav.permanentRedirect.mockClear();
});

const root = process.cwd();
function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("/contratar", () => {
  it("redirige permanentemente a /solicitar-informacion en la landing", () => {
    expect(() => ContractRoute()).toThrow("PERMANENT:/solicitar-informacion");
  });

  it("en la demo publica redirige a la landing configurada, sin enviar nada", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://marjym.example/");
    expect(() => ContractRoute()).toThrow("REDIRECT:https://marjym.example/solicitar-informacion");
    expect(nav.permanentRedirect).not.toHaveBeenCalled();
  });
});

describe("/solicitar-informacion en la demo", () => {
  it("redirige a la landing real en vez de mostrar el formulario", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://marjym.example");
    expect(() => InformationRoute()).toThrow("REDIRECT:https://marjym.example/solicitar-informacion");
  });
});

describe("CTAs comerciales", () => {
  const files = [
    "src/modules/marketing/components/LandingHero.tsx",
    "src/modules/marketing/components/LandingNavbar.tsx",
    "src/modules/marketing/components/LandingPricing.tsx",
    "src/modules/marketing/components/LandingFaq.tsx",
    "src/modules/marketing/components/LandingFeatures.tsx",
  ];

  it.each(files)("%s ya no ofrece contratar ni enlaza a /contratar", (file) => {
    const text = source(file);
    expect(text).not.toMatch(/Contratar MARJYM/);
    expect(text).not.toMatch(/["'`]\/contratar/);
  });

  it("el hero y el navbar enlazan al formulario de informacion", () => {
    expect(source(files[0])).toContain("/solicitar-informacion");
    expect(source(files[1])).toContain("/solicitar-informacion");
  });

  it("no queda codigo de contratacion automatica", () => {
    expect(existsSync(join(root, "src/modules/contracting"))).toBe(false);
  });
});
