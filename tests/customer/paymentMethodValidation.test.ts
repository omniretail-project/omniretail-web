import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentMethodFormDto } from "@/modules/customer/application/dto/PaymentMethodFormDto";
import { validatePaymentMethodForm } from "@/modules/customer/validation/paymentMethod.validation";

const VALID_FORM: PaymentMethodFormDto = {
  cardNumber: "4242 4242 4242 4242",
  cardholderName: "Ana López",
  expiration: "12/30",
  cvv: "123",
  issuingBank: "Banco Industrial",
};

describe("validatePaymentMethodForm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acepta las tres tarjetas de prueba", () => {
    expect(validatePaymentMethodForm(VALID_FORM, "create")).toEqual({});
    expect(
      validatePaymentMethodForm({ ...VALID_FORM, cardNumber: "5555 5555 5555 4444" }, "create"),
    ).toEqual({});
    expect(
      validatePaymentMethodForm(
        { ...VALID_FORM, cardNumber: "3782 822463 10005", cvv: "1234" },
        "create",
      ),
    ).toEqual({});
  });

  it("rechaza un número inválido", () => {
    expect(
      validatePaymentMethodForm({ ...VALID_FORM, cardNumber: "4242 4242 4242 4241" }, "create")
        .cardNumber,
    ).toBe("El número de tarjeta no es válido.");
    expect(validatePaymentMethodForm({ ...VALID_FORM, cardNumber: "4242" }, "create").cardNumber).toBe(
      "Completa un número de tarjeta Visa, Mastercard o American Express.",
    );
    expect(validatePaymentMethodForm({ ...VALID_FORM, cardNumber: "" }, "create").cardNumber).toBe(
      "Ingrese el número de tarjeta.",
    );
  });

  it("rechaza una marca no aceptada (Discover)", () => {
    expect(
      validatePaymentMethodForm({ ...VALID_FORM, cardNumber: "6011 1111 1111 1117" }, "create")
        .cardNumber,
    ).toBe("Solo se aceptan tarjetas Visa, Mastercard o American Express.");
  });

  it("rechaza una tarjeta vencida", () => {
    expect(validatePaymentMethodForm({ ...VALID_FORM, expiration: "09/26" }, "create").expiration).toBe(
      "La tarjeta está vencida.",
    );
    expect(validatePaymentMethodForm({ ...VALID_FORM, expiration: "09/26" }, "edit").expiration).toBe(
      "La tarjeta está vencida.",
    );
  });

  it("rechaza un CVV del largo equivocado para la marca", () => {
    expect(validatePaymentMethodForm({ ...VALID_FORM, cvv: "12" }, "create").cvv).toBe(
      "Ingresa un código de seguridad de 3 dígitos.",
    );
    expect(
      validatePaymentMethodForm(
        { ...VALID_FORM, cardNumber: "3782 822463 10005", cvv: "123" },
        "create",
      ).cvv,
    ).toBe("Ingresa un código de seguridad de 4 dígitos.");
  });

  it("exige el titular al crear y lo deja opcional al editar", () => {
    expect(validatePaymentMethodForm({ ...VALID_FORM, cardholderName: "" }, "create").cardholderName)
      .toBe("Ingrese el nombre del titular.");
    expect(
      validatePaymentMethodForm({ ...VALID_FORM, cardholderName: "   " }, "create").cardholderName,
    ).toBe("Ingrese el nombre del titular.");
    expect(
      validatePaymentMethodForm({ ...VALID_FORM, cardholderName: "Ana 123" }, "create").cardholderName,
    ).toBe("El nombre del titular solo permite letras, espacios, guiones y apóstrofes.");
    expect(validatePaymentMethodForm({ ...VALID_FORM, cardholderName: "" }, "edit")).toEqual({});
    expect(
      validatePaymentMethodForm({ ...VALID_FORM, cardholderName: "Ana 123" }, "edit").cardholderName,
    ).toBe("El nombre del titular solo permite letras, espacios, guiones y apóstrofes.");
  });

  it("al editar no valida número, CVV ni banco", () => {
    expect(
      validatePaymentMethodForm(
        { ...VALID_FORM, cardNumber: "", cvv: "", issuingBank: "" },
        "edit",
      ),
    ).toEqual({});
  });
});
