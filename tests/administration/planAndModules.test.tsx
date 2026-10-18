import { render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SaasCapabilityKey, SaasLimitKey } from "@/core/enums";

const hook = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/modules/administration/hooks/useTenantSubscription", () => ({
  useTenantSubscription: () => hook.value,
}));

import {
  PLAN_CHANGE_NOTE,
  PlanSubscriptionPage,
} from "@/modules/administration/pages/PlanSubscriptionPage";

function details(addonCodes: string[]) {
  return {
    tenantId: "t",
    addonCodes,
    subscription: { status: "ACTIVE", startedAt: "2026-01-01T00:00:00.000Z" },
    plan: { id: "plan-basic", code: "BASIC", name: "Plan Básico" },
    capabilities: [
      { key: SaasCapabilityKey.inventory, included: true },
      { key: SaasCapabilityKey.ecommerce, included: addonCodes.includes("ecommerce_delivery") },
    ],
    usage: [
      { key: SaasLimitKey.maxEmployees, current: 3, limit: 10 },
      { key: SaasLimitKey.maxBranches, current: 1, limit: null },
    ],
  };
}

function show(addonCodes: string[]) {
  hook.value = {
    loading: false,
    canRead: true,
    error: null,
    details: details(addonCodes),
    reload: vi.fn(),
  };
  return render(<PlanSubscriptionPage />);
}

describe("Mi plan y módulos (solo lectura)", () => {
  it("muestra plan, modulos, uso y la nota para solicitar cambios", () => {
    show([]);
    expect(screen.getByRole("heading", { name: "Mi plan y módulos" })).toBeInTheDocument();
    expect(screen.getByText("Plan Básico")).toBeInTheDocument();
    expect(screen.getByText("Inventario")).toBeInTheDocument();
    expect(screen.getByText(PLAN_CHANGE_NOTE)).toBeInTheDocument();
    expect(screen.getByText(/sin límite definido/)).toBeInTheDocument();
  });

  it("no ofrece acciones de modificacion ni facturacion simulada", () => {
    show(["advanced_reports"]);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /guardar|actualizar|cambiar plan|contratar/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/total proyectado|renovaci|cobro automático|factura/i),
    ).not.toBeInTheDocument();
  });

  it("un tenant sin complementos no los muestra activos", () => {
    show([]);
    expect(screen.queryByText("Activo")).not.toBeInTheDocument();
    expect(screen.getAllByText("No activo")).toHaveLength(2);
  });

  it("el tenant demo con ambos complementos los muestra activos", () => {
    show(["ecommerce_delivery", "advanced_reports"]);
    expect(screen.getAllByText("Activo")).toHaveLength(2);
    expect(screen.queryByText("No activo")).not.toBeInTheDocument();
  });

  it("sin admin.plans.read no muestra datos del plan", () => {
    hook.value = { loading: false, canRead: false, error: null, details: null, reload: vi.fn() };
    render(<PlanSubscriptionPage />);
    expect(screen.queryByText("Plan Básico")).not.toBeInTheDocument();
  });

  it("los servicios de mutacion de plan ya no existen", () => {
    const base = join(process.cwd(), "src/modules/administration");
    for (const file of [
      "application/services/ChangeTenantPlanService.ts",
      "application/services/UpdateTenantSubscriptionService.ts",
      "application/services/subscriptionBilling.ts",
      "components/PlanPickerSection.tsx",
    ]) {
      expect(existsSync(join(base, file))).toBe(false);
    }
  });
});
