import { validatePhoneNumber } from "@/config/contact-policy";
import { validateEmail } from "@/config/email-policy";
import { DeliveryMethod } from "@/core/enums";
import type { CardTerminalResultDto, CheckoutDto } from "@/modules/pos/application/dto/CheckoutDto";

export type CheckoutValidationErrors = Partial<
  Record<
    | "taxId"
    | "legalName"
    | "fiscalAddress"
    | "cashAmount"
    | "cashReceived"
    | "changeAmount"
    | "cardAmount"
    | "cardTerminal"
    | "transferAmount"
    | "bankAccountId"
    | "transferReference"
    | "transferExternallyVerified"
    | "paymentTotal"
    | "recipientName"
    | "recipientPhone"
    | "notificationEmail"
    | "deliveryCity"
    | "deliveryAddress",
    string
  >
>;

export interface CheckoutAmounts {
  appliedAmount: number;
  differenceAmount: number;
  changeAmount: number;
}

export interface CheckoutValidationResult extends CheckoutAmounts {
  errors: CheckoutValidationErrors;
  isValid: boolean;
}

export function calculateCheckoutAmounts(checkout: CheckoutDto, total: number): CheckoutAmounts {
  const cashCents = toCents(checkout.cashAmount);
  const cardCents = toCents(checkout.cardAmount);
  const transferCents = toCents(checkout.transferAmount);
  const totalCents = toCents(total);
  const appliedCents = getAppliedCents(checkout, cashCents, cardCents, transferCents);
  const receivedCents = toCents(checkout.cashReceived);
  const changeCents = cashCents > 0 ? Math.max(0, receivedCents - cashCents) : 0;

  return {
    appliedAmount: fromCents(appliedCents),
    differenceAmount: fromCents(totalCents - appliedCents),
    changeAmount: fromCents(changeCents),
  };
}

export function validateCheckout(checkout: CheckoutDto, total: number): CheckoutValidationResult {
  const errors: CheckoutValidationErrors = {};
  const totalCents = toCents(total);
  const cashCents = toCents(checkout.cashAmount);
  const cashReceivedCents = toCents(checkout.cashReceived);
  const cardCents = toCents(checkout.cardAmount);
  const transferCents = toCents(checkout.transferAmount);
  const amounts = calculateCheckoutAmounts(checkout, total);

  validateDocument(checkout, errors);
  validateDelivery(checkout, errors);
  validateNonNegativeAmounts(checkout, errors);

  if (checkout.paymentMode === "cash") {
    if (cashCents !== totalCents) {
      errors.cashAmount = "El monto en efectivo debe cubrir exactamente el total.";
    }
    validateCash(cashCents, cashReceivedCents, checkout.changeAmount, errors);
  }

  if (checkout.paymentMode === "card") {
    if (cardCents !== totalCents) {
      errors.cardAmount = "El monto de tarjeta debe cubrir exactamente el total.";
    }
    validateCard(cardCents, checkout.cardTerminalResult, errors);
  }

  if (checkout.paymentMode === "transfer") {
    if (transferCents !== totalCents) {
      errors.transferAmount = "El monto de transferencia debe cubrir exactamente el total.";
    }
    validateTransfer(
      transferCents,
      checkout.bankAccountId,
      checkout.transferReference,
      checkout.transferExternallyVerified,
      errors,
    );
  }

  if (checkout.paymentMode === "mixed") {
    const appliedCents = cashCents + cardCents + transferCents;
    if (appliedCents <= 0) {
      errors.paymentTotal = "Ingresa al menos un monto mayor que cero.";
    } else if (appliedCents !== totalCents) {
      errors.paymentTotal = "La suma de los pagos debe ser exactamente igual al total.";
    }
    if (cashCents > 0) {
      validateCash(cashCents, cashReceivedCents, checkout.changeAmount, errors);
    }
    validateCard(cardCents, checkout.cardTerminalResult, errors);
    validateTransfer(
      transferCents,
      checkout.bankAccountId,
      checkout.transferReference,
      checkout.transferExternallyVerified,
      errors,
    );
  }

  return {
    ...amounts,
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

function validateDelivery(checkout: CheckoutDto, errors: CheckoutValidationErrors) {
  if (checkout.deliveryMethod === DeliveryMethod.store_pickup) {
    const contact = checkout.storePickupContact;
    if (!contact?.recipientName.trim()) {
      errors.recipientName = "El nombre de quien retira es obligatorio.";
    }
    const phone = contact?.recipientPhone?.trim() ?? "";
    if (!phone) {
      errors.recipientPhone = "El teléfono es obligatorio.";
    } else {
      const phoneError = validatePhoneNumber(phone);
      if (phoneError) errors.recipientPhone = phoneError;
    }
    return;
  }
  if (checkout.deliveryMethod !== DeliveryMethod.home_delivery) return;

  const address = checkout.deliveryAddress;
  if (!address?.recipientName.trim()) {
    errors.recipientName = "El nombre de contacto es obligatorio.";
  }

  const phone = address?.recipientPhone?.trim() ?? "";
  if (!phone) {
    errors.recipientPhone = "El teléfono es obligatorio.";
  } else {
    const phoneError = validatePhoneNumber(phone);
    if (phoneError) errors.recipientPhone = phoneError;
  }

  if (!address?.city.trim()) errors.deliveryCity = "La ciudad es obligatoria.";
  if (!address?.line1.trim()) {
    errors.deliveryAddress = "La dirección de entrega es obligatoria.";
  }

  if (checkout.notificationContact.emailMode === "send") {
    const emailError = validateEmail(checkout.notificationContact.email);
    if (emailError) errors.notificationEmail = emailError;
  }
}

function validateDocument(checkout: CheckoutDto, errors: CheckoutValidationErrors) {
  if (checkout.documentType !== "invoice") return;

  if (!checkout.invoiceData.taxId.trim()) errors.taxId = "El NIT es obligatorio.";
  if (!checkout.invoiceData.legalName.trim()) {
    errors.legalName = "El nombre o razón social es obligatorio.";
  }
  if (!checkout.invoiceData.fiscalAddress.trim()) {
    errors.fiscalAddress = "La dirección fiscal es obligatoria.";
  }
}

function validateNonNegativeAmounts(checkout: CheckoutDto, errors: CheckoutValidationErrors) {
  if (!Number.isFinite(checkout.cashAmount) || checkout.cashAmount < 0) {
    errors.cashAmount = "El monto en efectivo no puede ser negativo.";
  }
  if (!Number.isFinite(checkout.cashReceived) || checkout.cashReceived < 0) {
    errors.cashReceived = "El monto recibido no puede ser negativo.";
  }
  if (!Number.isFinite(checkout.cardAmount) || checkout.cardAmount < 0) {
    errors.cardAmount = "El monto de tarjeta no puede ser negativo.";
  }
  if (!Number.isFinite(checkout.transferAmount) || checkout.transferAmount < 0) {
    errors.transferAmount = "El monto de transferencia no puede ser negativo.";
  }
}

function validateCash(
  cashCents: number,
  receivedCents: number,
  changeAmount: number,
  errors: CheckoutValidationErrors,
) {
  if (receivedCents < cashCents) {
    errors.cashReceived = "El monto recibido no puede ser menor al efectivo aplicado.";
  }

  const expectedChangeCents = Math.max(0, receivedCents - cashCents);
  if (toCents(changeAmount) !== expectedChangeCents) {
    errors.changeAmount = "El cambio calculado no es correcto.";
  }
}

function validateCard(
  cardCents: number,
  terminalResult: CardTerminalResultDto,
  errors: CheckoutValidationErrors,
) {
  if (cardCents <= 0) return;

  try {
    getApprovedCardTerminalReference(terminalResult, fromCents(cardCents));
  } catch (error) {
    errors.cardTerminal =
      error instanceof Error ? error.message : "El pago con tarjeta debe procesarse nuevamente.";
  }
}

export function getApprovedCardTerminalReference(
  terminalResult: CardTerminalResultDto,
  cardAmount: number,
) {
  if (terminalResult.status === "processing") {
    throw new Error("Espera a que la terminal termine de procesar el pago.");
  }
  if (terminalResult.status === "rejected") {
    throw new Error("Pago rechazado por terminal.");
  }
  if (terminalResult.status !== "approved") {
    throw new Error("Procesa el pago con la terminal antes de confirmar.");
  }
  if (toCents(terminalResult.authorizedAmount ?? Number.NaN) !== toCents(cardAmount)) {
    throw new Error("El monto cambió; procesa nuevamente el pago con tarjeta.");
  }

  const reference = terminalResult.reference?.trim() ?? "";
  if (!/^AUTH-\d{6,}$/.test(reference)) {
    throw new Error("La terminal no devolvió una autorización externa válida.");
  }
  return reference;
}

function validateTransfer(
  transferCents: number,
  bankAccountId: string,
  transferReference: string,
  transferExternallyVerified: boolean,
  errors: CheckoutValidationErrors,
) {
  if (transferCents <= 0) return;

  if (!bankAccountId) errors.bankAccountId = "Selecciona una cuenta bancaria.";
  if (!transferReference.trim()) {
    errors.transferReference = "La referencia de transferencia es obligatoria.";
  }
  if (!transferExternallyVerified) {
    errors.transferExternallyVerified =
      "Confirma que verificaste externamente la recepción de la transferencia.";
  }
}

function getAppliedCents(
  checkout: CheckoutDto,
  cashCents: number,
  cardCents: number,
  transferCents: number,
) {
  if (checkout.paymentMode === "cash") return cashCents;
  if (checkout.paymentMode === "card") return cardCents;
  if (checkout.paymentMode === "transfer") return transferCents;
  return cashCents + cardCents + transferCents;
}

function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(value: number): number {
  return value / 100;
}
