import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ download: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a"> & { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/modules/storefront/components/StorefrontOrderProgress", () => ({
  StorefrontOrderProgress: () => <span>progreso</span>,
}));
vi.mock("@/modules/storefront/application/services/StorefrontReceiptPdfService", () => ({
  downloadStorefrontReceiptPdf: state.download,
}));
vi.mock("@/modules/storefront/providers/StorefrontCheckoutConfirmationProvider", () => ({
  useStorefrontCheckoutConfirmation: () => ({
    result: {
      orderNumber: "WEB-123", trackingToken: "token-123", guestTrackingEnabled: true,
      confirmationEmailSent: true, paymentStatus: "approved", orderStatus: "confirmed",
      hasInventoryReservations: false, total: 100,
      deliveryAddress: { recipientName: "Ana", line1: "5a calle", city: "Guatemala", phone: "5555" },
      items: [{ sku: "TAL-001", name: "Taladro", quantity: 1, unitPrice: 100, subtotal: 100 }],
    },
  }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontOrderConfirmation", () => ({
  useStorefrontOrderConfirmation: () => ({ data: null, loading: false }),
}));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => ({ tenantSlug: "ferreteria", config: { storeName: "Ferretería" } }),
}));
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({
  useStorefrontRoutes: () => ({ catalog: () => "/catalogo", tracking: () => "/seguimiento" }),
}));

import { OrderConfirmationPage } from "@/modules/storefront/pages/OrderConfirmationPage";

describe("OrderConfirmationPage", () => {
  it("descarga el comprobante usando el tenant y token del pedido", async () => {
    render(<OrderConfirmationPage />);

    fireEvent.click(screen.getByRole("button", { name: "Descargar comprobante PDF" }));

    await waitFor(() => expect(state.download).toHaveBeenCalledWith({
      tenantSlug: "ferreteria", trackingToken: "token-123",
    }));
  });
});
