import { describe, expect, it } from "vitest";
import {
  calculateShippingCost,
  DEFAULT_ECOMMERCE_SHIPPING,
  DEFAULT_POS_SHIPPING,
} from "@/config/shipping-policy";
import {
  toShippingConfig,
  toShippingConfigRequest,
} from "@/infrastructure/api/apiShippingConfigMapper";
import type { ShippingConfigFormValue } from "@/modules/administration/application/dto/ShippingConfigDto";
import {
  getShippingConfigFieldErrors,
  toShippingConfigFormValue,
  toShippingConfigInput,
} from "@/modules/administration/validation/shippingConfig.validation";

function formValue(overrides: Partial<ShippingConfigFormValue> = {}): ShippingConfigFormValue {
  return {
    ecommerce: { enabled: true, deliveryFee: "25.00", freeShippingThreshold: "300.00" },
    pos: { enabled: true, deliveryFee: "15", freeShippingThreshold: "" },
    ...overrides,
  };
}

describe("calculateShippingCost", () => {
  const config = { enabled: true, deliveryFee: 25, freeShippingThreshold: 300 };

  it("cobra la tarifa bajo el umbral y es gratis desde el umbral", () => {
    expect(calculateShippingCost(config, 299.99)).toBe(25);
    expect(calculateShippingCost(config, 300)).toBe(0);
    expect(calculateShippingCost(config, 450)).toBe(0);
  });

  it("sin umbral siempre cobra la tarifa", () => {
    expect(calculateShippingCost({ enabled: true, deliveryFee: 12.5 }, 10_000)).toBe(12.5);
  });

  it("un canal desactivado nunca cobra", () => {
    expect(calculateShippingCost({ ...config, enabled: false }, 10)).toBe(0);
  });

  it("los valores por defecto coinciden con los del backend", () => {
    expect(calculateShippingCost(DEFAULT_ECOMMERCE_SHIPPING, 100)).toBe(25);
    expect(calculateShippingCost(DEFAULT_ECOMMERCE_SHIPPING, 300)).toBe(0);
    expect(calculateShippingCost(DEFAULT_POS_SHIPPING, 100)).toBe(0);
  });
});

describe("validación del formulario de costo de envío", () => {
  it("acepta montos con hasta 2 decimales y umbral vacío", () => {
    expect(getShippingConfigFieldErrors(formValue())).toEqual({});
    expect(toShippingConfigInput(formValue())).toEqual({
      ecommerce: { enabled: true, deliveryFee: 25, freeShippingThreshold: 300 },
      pos: { enabled: true, deliveryFee: 15, freeShippingThreshold: undefined },
    });
  });

  it("rechaza tarifa vacía, negativa o con más de 2 decimales", () => {
    const errors = getShippingConfigFieldErrors(
      formValue({
        ecommerce: { enabled: true, deliveryFee: "", freeShippingThreshold: "-5" },
        pos: { enabled: true, deliveryFee: "10.555", freeShippingThreshold: "" },
      }),
    );

    expect(Object.keys(errors).sort()).toEqual([
      "ecommerce.deliveryFee",
      "ecommerce.freeShippingThreshold",
      "pos.deliveryFee",
    ]);
    expect(() =>
      toShippingConfigInput(
        formValue({ pos: { enabled: true, deliveryFee: "abc", freeShippingThreshold: "" } }),
      ),
    ).toThrow();
  });

  it("convierte la configuración guardada al formulario con 2 decimales", () => {
    expect(
      toShippingConfigFormValue({
        ecommerce: { enabled: true, deliveryFee: 25, freeShippingThreshold: 300 },
        pos: { enabled: false, deliveryFee: 0 },
      }),
    ).toEqual({
      ecommerce: { enabled: true, deliveryFee: "25.00", freeShippingThreshold: "300.00" },
      pos: { enabled: false, deliveryFee: "0.00", freeShippingThreshold: "" },
    });
  });
});

describe("mapper de /administration/shipping-config", () => {
  it("convierte la respuesta del backend y usa valores por defecto si falta un canal", () => {
    expect(
      toShippingConfig(
        { ecommerce: { enabled: true, deliveryFee: "30.00", freeShippingThreshold: null } },
        "tenant-1",
      ),
    ).toEqual({
      tenantId: "tenant-1",
      ecommerce: { enabled: true, deliveryFee: 30, freeShippingThreshold: undefined },
      pos: DEFAULT_POS_SHIPPING,
    });
  });

  it("envía null cuando no hay umbral de envío gratis", () => {
    expect(
      toShippingConfigRequest({
        ecommerce: { enabled: true, deliveryFee: 25, freeShippingThreshold: 300 },
        pos: { enabled: true, deliveryFee: 15 },
      }),
    ).toEqual({
      ecommerce: { enabled: true, deliveryFee: 25, freeShippingThreshold: 300 },
      pos: { enabled: true, deliveryFee: 15, freeShippingThreshold: null },
    });
  });
});
