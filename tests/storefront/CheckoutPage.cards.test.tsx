// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutPage } from "@/modules/storefront/pages/CheckoutPage";

const state = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({ user: { id: "user-ana" } }),
}));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = {
    customers: {
      getByUserId: async () => ({
        id: "customer-ana",
        tenantId: "tenant-demo",
        email: "ana@example.com",
        phone: "55551234",
      }),
    },
    customerPaymentMethods: { getByCustomer: async () => [] },
    addresses: {
      getByCustomer: async () => [
        {
          id: "address-ana",
          recipientName: "Ana López",
          line1: "5a calle 10-20 zona 1",
          city: "Guatemala",
          stateOrDepartment: "Guatemala",
          isDefault: true,
        },
      ],
    },
  };
  return { useRepositories: () => repositories };
});
vi.mock("@/modules/storefront/hooks/useStorefrontCheckout", () => ({
  useStorefrontCheckout: () => ({
    submitting: false,
    error: null,
    result: null,
    submit: state.submit,
  }),
}));
vi.mock("@/modules/storefront/providers/StorefrontCartProvider", () => ({
  useStorefrontCart: () => ({
    items: [{ productId: "product-1", name: "Martillo", quantity: 1, unitPrice: 100 }],
    subtotal: 100,
  }),
}));
vi.mock("@/modules/storefront/providers/StorefrontCheckoutConfirmationProvider", () => ({
  useStorefrontCheckoutConfirmation: () => ({ setResult: vi.fn() }),
}));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => ({
    tenantId: "tenant-demo",
    config: { accountRequired: false },
    loading: false,
  }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({
  useStorefrontRoutes: () => ({
    cart: () => "/carrito",
    catalog: () => "/catalogo",
    confirmation: () => "/confirmacion",
    login: () => "/iniciar-sesion",
    register: () => "/registro",
  }),
}));

/** Regresión del checkout de María: sigue aceptando las tres tarjetas de prueba. */
describe("CheckoutPage con tarjeta nueva", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15));
    state.submit.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["4242424242424242", "4242 4242 4242 4242", "123", "4242"],
    ["5555555555554444", "5555 5555 5555 4444", "123", "4444"],
    ["378282246310005", "3782 822463 10005", "1234", "0005"],
  ])("acepta %s", async (typed, formatted, cvv, last4) => {
    render(<CheckoutPage />);

    const continueButton = await screen.findByRole("button", { name: "Continuar al pago" });
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);

    const cardNumber = await screen.findByLabelText("Número de tarjeta");
    fireEvent.change(cardNumber, { target: { value: typed } });
    expect(cardNumber).toHaveValue(formatted);
    fireEvent.change(screen.getByLabelText("Nombre del titular"), {
      target: { value: "Ana López" },
    });
    fireEvent.change(screen.getByLabelText("Fecha de vencimiento"), { target: { value: "1230" } });
    fireEvent.change(screen.getByLabelText("Código de seguridad (CVV)"), {
      target: { value: cvv },
    });

    const submitButton = screen.getByRole("button", { name: /Realizar pedido/ });
    expect(submitButton).toBeEnabled();
    fireEvent.click(submitButton);

    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    const submitted = state.submit.mock.calls[0][0];
    expect(submitted.cardLastFour).toBe(last4);
    expect(JSON.stringify(submitted)).not.toContain(typed);
  });
});
