import { describe, expect, it } from "vitest";
import { demoSeedDatabase } from "@/infrastructure/mock/seeds/demoSeed";

describe("complementos del tenant demo", () => {
  it("el tenant demo trae los dos complementos activos", () => {
    const demo = demoSeedDatabase.tenantSubscriptions.find((item) => item.tenantId === "tenant-demo");
    expect(demo?.addonCodes).toEqual(["ecommerce_delivery", "advanced_reports"]);
  });

  it("cualquier otro tenant semilla no tiene complementos por defecto", () => {
    const others = demoSeedDatabase.tenantSubscriptions.filter((item) => item.tenantId !== "tenant-demo");
    for (const other of others) expect(other.addonCodes ?? []).toEqual([]);
  });
});
