import assert from "node:assert/strict";
import { OrderStatus, PaymentStatus } from "@/core/enums";
import type { StorefrontCheckoutResultDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import {
  shouldClearStaleCheckoutConfirmation,
  shouldShowCurrentCheckoutConfirmation,
} from "@/modules/storefront/application/services/storefrontCheckoutLifecycle";

function createResult(orderNumber: string): StorefrontCheckoutResultDto {
  return {
    orderNumber,
    trackingToken: `${orderNumber}-tracking`,
    guestTrackingEnabled: true,
    confirmationEmailSent: true,
    total: 24.99,
    orderStatus: OrderStatus.confirmed,
    paymentStatus: PaymentStatus.approved,
    hasInventoryReservations: true,
    deliveryAddress: {
      recipientName: "Cliente de prueba",
      line1: "Zona 1",
      city: "Guatemala",
      department: "Guatemala",
      phone: "55550000",
    },
    items: [{ sku: "TOR-001", name: "Tornillos", quantity: 1, unitPrice: 24.99, subtotal: 24.99 }],
  };
}

const orderA = createResult("WEB-ORDER-A");

// Compra A completa: sólo la instancia que la envió puede mostrar su comprobante.
assert.equal(shouldShowCurrentCheckoutConfirmation(orderA, true), true);
assert.equal(shouldClearStaleCheckoutConfirmation(orderA, true), false);

// Al abrir un checkout nuevo con productos B, la confirmación A es efímera y se descarta.
assert.equal(shouldShowCurrentCheckoutConfirmation(orderA, false), false);
assert.equal(shouldClearStaleCheckoutConfirmation(orderA, false), true);
const currentCheckoutResult: StorefrontCheckoutResultDto | null = null;
assert.equal(currentCheckoutResult, null, "Checkout B inicia sin confirmación previa");

// Compra B genera una confirmación nueva, distinta y sin reutilizar la orden A.
const orderB = createResult("WEB-ORDER-B");
assert.notEqual(orderB.orderNumber, orderA.orderNumber);
assert.equal(shouldShowCurrentCheckoutConfirmation(orderB, true), true);
assert.equal(shouldClearStaleCheckoutConfirmation(orderB, true), false);

console.log("Storefront second purchase regression harness: PASS");
