import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadStorefrontReceiptPdf } from "@/modules/storefront/application/services/StorefrontReceiptPdfService";

describe("downloadStorefrontReceiptPdf", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("descarga el PDF generado por el backend", async () => {
    const createObjectURL = vi.fn(() => "blob:receipt");
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response("pdf", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await downloadStorefrontReceiptPdf({ tenantSlug: "ferre pharma", trackingToken: "token/123" });

    expect(fetchMock).toHaveBeenCalledWith("/api/public/ferre%20pharma/receipt/token%2F123");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt");
  });

  it("informa cuando el comprobante no está disponible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(
      downloadStorefrontReceiptPdf({ tenantSlug: "ferrepharma-demo", trackingToken: "missing" }),
    ).rejects.toThrow("No se pudo descargar el comprobante.");
  });
});
