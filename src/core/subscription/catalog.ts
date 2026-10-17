import { SaasCapabilityKey } from "@/core/enums";

export const BASE_PLAN_ID = "plan-basic";
export const BASE_MONTHLY_QUETZALES = 199;
export const SUBSCRIPTION_ADDONS = [
  {
    code: "ecommerce_delivery",
    name: "E-commerce + Entregas",
    description: "Tienda en línea, pedidos digitales y gestión de despachos.",
    monthlyQuetzales: 129,
    capabilities: [SaasCapabilityKey.ecommerce, SaasCapabilityKey.delivery],
  },
  {
    code: "advanced_reports",
    name: "Reportes avanzados",
    description: "Exporta tus reportes de ventas, compras, inventario y pagos para analizarlos fuera de MARJYM.",
    monthlyQuetzales: 99,
    capabilities: [SaasCapabilityKey.advancedReports],
  },
] as const;

export type SubscriptionAddonCode = (typeof SUBSCRIPTION_ADDONS)[number]["code"];

export function isSubscriptionAddonCode(value: string): value is SubscriptionAddonCode {
  return SUBSCRIPTION_ADDONS.some((addon) => addon.code === value);
}

export function subscriptionTotalQuetzales(codes: readonly string[]): number {
  return BASE_MONTHLY_QUETZALES + SUBSCRIPTION_ADDONS.reduce(
    (sum, addon) => sum + (codes.includes(addon.code) ? addon.monthlyQuetzales : 0),
    0,
  );
}
