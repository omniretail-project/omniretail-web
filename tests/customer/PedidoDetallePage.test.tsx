import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ download: vi.fn(), showToast: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a"> & { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/modules/customer/hooks/useCustomerOrderDetail", () => ({
  useCustomerOrderDetail: () => ({
    loading: false, error: null,
    order: {
      orderNumber: "WEB-123", trackingToken: "token-123", createdAt: "2026-10-18T12:00:00Z",
      status: "confirmed", total: 100, subtotal: 100, shippingTotal: 0,
      items: [{ sku: "TAL-001", name: "Taladro", quantity: 1, unitPrice: 100, subtotal: 100 }],
    },
  }),
}));
vi.mock("@/modules/storefront/application/services/StorefrontReceiptPdfService", () => ({
  downloadStorefrontReceiptPdf: state.download,
}));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({ usePublicTenant: () => ({ tenantSlug: "ferreteria" }) }));
vi.mock("@/modules/storefront/hooks/useStorefrontRoutes", () => ({
  useStorefrontRoutes: () => ({ accountOrders: () => "/mis-pedidos", tracking: () => "/seguimiento" }),
}));
vi.mock("@/shared/components/Button", () => ({
  Button: ({ children, ...props }: ComponentProps<"button"> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/shared/components/icons", () => ({
  CompassIcon: () => null, CreditCardIcon: () => null, DownloadIcon: () => null,
  PackageIcon: () => null, TruckIcon: () => null,
}));
vi.mock("@/shared/components/StatusBadge", () => ({ StatusBadge: () => <span>confirmado</span> }));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: state.showToast }) }));

import { PedidoDetallePage } from "@/modules/customer/pages/PedidoDetallePage";

describe("PedidoDetallePage", () => {
  it("descarga el comprobante desde el detalle del pedido", async () => {
    render(<PedidoDetallePage orderId="order-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Descargar comprobante" }));

    await waitFor(() => expect(state.download).toHaveBeenCalledWith({
      tenantSlug: "ferreteria", trackingToken: "token-123",
    }));
  });
});
