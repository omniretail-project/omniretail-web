import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatCardExpiration,
  formatCardNumber,
  getCardExpirationError,
  isCardNumberComplete,
  parseCardExpiration,
} from "@/config/card-input-policy";
import { mockTokenizeCard } from "@/infrastructure/payments/mockTokenizeCard";

describe("card-input-policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("agrupa Visa y Mastercard 4-4-4-4 y American Express 4-6-5", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("5555-5555-5555-4444")).toBe("5555 5555 5555 4444");
    expect(formatCardNumber("378282246310005")).toBe("3782 822463 10005");
    expect(formatCardNumber("37828")).toBe("3782 8");
  });

  it("formatea y lee el vencimiento MM/AA", () => {
    expect(formatCardExpiration("1230")).toBe("12/30");
    expect(parseCardExpiration("07/29")).toEqual({ month: 7, year: 2029 });
    expect(parseCardExpiration("13/29")).toBeNull();
  });

  it("rechaza una tarjeta vencida y acepta el mes en curso", () => {
    expect(getCardExpirationError("09/26")).toBe("La tarjeta está vencida.");
    expect(getCardExpirationError("10/26")).toBeNull();
    expect(getCardExpirationError("1/26")).toBe("Ingresa una fecha válida en formato MM/AA.");
    expect(getCardExpirationError("12/99")).toBe("Ingresa una fecha de vencimiento válida.");
  });

  it("solo da por completo un número de marca aceptada, del largo correcto y que pasa Luhn", () => {
    expect(isCardNumberComplete("4242424242424242")).toBe(true);
    expect(isCardNumberComplete("5555555555554444")).toBe(true);
    expect(isCardNumberComplete("378282246310005")).toBe(true);
    expect(isCardNumberComplete("4242424242424241")).toBe(false);
    expect(isCardNumberComplete("424242424242")).toBe(false);
    expect(isCardNumberComplete("6011111111111117")).toBe(false);
  });
});

describe("mockTokenizeCard", () => {
  it.each([
    ["4242 4242 4242 4242", "123", "Visa", "4242"],
    ["5555 5555 5555 4444", "123", "Mastercard", "4444"],
    ["3782 822463 10005", "1234", "American Express", "0005"],
  ])("devuelve marca y last4 de %s", (cardNumber, cvv, brand, last4) => {
    const result = mockTokenizeCard({ cardNumber, cvv, expirationMonth: 12, expirationYear: 2030 });
    expect(result.brand).toBe(brand);
    expect(result.last4).toBe(last4);
    expect(JSON.stringify(result)).not.toContain(cardNumber.replace(/\D/g, ""));
    expect(JSON.stringify(result)).not.toContain(`"${cvv}"`);
  });

  it("rechaza marcas no aceptadas, números inválidos y CVV del largo equivocado", () => {
    const base = { expirationMonth: 12, expirationYear: 2030 };
    expect(() => mockTokenizeCard({ ...base, cardNumber: "6011111111111117", cvv: "123" })).toThrow(
      "Solo se aceptan tarjetas Visa, Mastercard o American Express.",
    );
    expect(() => mockTokenizeCard({ ...base, cardNumber: "4242424242424241", cvv: "123" })).toThrow(
      "El número de tarjeta no es válido.",
    );
    expect(() => mockTokenizeCard({ ...base, cardNumber: "378282246310005", cvv: "123" })).toThrow(
      "Ingresa un código de seguridad de 4 dígitos.",
    );
    expect(() => mockTokenizeCard({ ...base, cardNumber: "4242424242424242", cvv: "1234" })).toThrow(
      "Ingresa un código de seguridad de 3 dígitos.",
    );
  });
});
