import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationItem } from "@/shared/types/navigation.types";

function flatten(items: NavigationItem[]): NavigationItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

async function loadNavigation() {
  vi.resetModules();
  const navigation = await import("@/config/navigation");
  return flatten(navigation.navigationConfig as NavigationItem[]).map((item) => item.href);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo navigation filtering", () => {
  it("keeps regularizacion outside the demo", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    const hrefs = await loadNavigation();
    expect(hrefs).toContain("/inventario/regularizacion");
  });

  it("hides only regularizacion in the public demo", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    const hrefs = await loadNavigation();
    expect(hrefs).not.toContain("/inventario/regularizacion");
    expect(hrefs).toContain("/inventario/alertas");
    expect(hrefs).toContain("/inventario/movimientos");
  });
});
