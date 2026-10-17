import { describe, expect, it } from "vitest";
import { DeliveryMethod } from "@/core/enums";
import { isKitDeferredSale } from "@/modules/pos/validation/kitDelivery";

describe("isKitDeferredSale", () => {
  it("solo bloquea cuando hay kits y la entrega es diferida", () => {
    expect(isKitDeferredSale(DeliveryMethod.immediate, true)).toBe(false);
    expect(isKitDeferredSale(DeliveryMethod.store_pickup, true)).toBe(true);
    expect(isKitDeferredSale(DeliveryMethod.home_delivery, true)).toBe(true);
    expect(isKitDeferredSale(DeliveryMethod.home_delivery, false)).toBe(false);
  });
});
