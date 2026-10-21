// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShippingChannelConfig } from "@/core/entities";
import { useStorefrontShipping } from "@/modules/storefront/hooks/useStorefrontShipping";

const state = vi.hoisted(() => ({ shipping: undefined as ShippingChannelConfig | undefined }));

vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => ({ config: state.shipping ? { shipping: state.shipping } : null }),
}));

function shippingFor(subtotal: number, shipping?: ShippingChannelConfig) {
  state.shipping = shipping;
  return renderHook(() => useStorefrontShipping(subtotal)).result.current;
}

describe("useStorefrontShipping", () => {
  it("usa la tarifa configurada y avisa desde cuánto es gratis", () => {
    expect(
      shippingFor(100, { enabled: true, deliveryFee: 30, freeShippingThreshold: 400 }),
    ).toEqual({ shippingTotal: 30, hint: "Envío gratis desde Q400.00." });
  });

  it("es gratis al alcanzar el umbral configurado", () => {
    expect(
      shippingFor(400, { enabled: true, deliveryFee: 30, freeShippingThreshold: 400 }),
    ).toEqual({ shippingTotal: 0, hint: "Tu compra tiene envío gratis." });
  });

  it("sin umbral cobra la tarifa sin aviso de envío gratis", () => {
    expect(shippingFor(1000, { enabled: true, deliveryFee: 12 })).toEqual({
      shippingTotal: 12,
      hint: null,
    });
  });

  it("con el canal desactivado el envío no tiene costo", () => {
    expect(shippingFor(50, { enabled: false, deliveryFee: 30 })).toEqual({
      shippingTotal: 0,
      hint: "El envío a domicilio no tiene costo.",
    });
  });

  it("sin configuración pública usa los valores por defecto (Q25, gratis desde Q300)", () => {
    expect(shippingFor(100)).toEqual({ shippingTotal: 25, hint: "Envío gratis desde Q300.00." });
  });
});
