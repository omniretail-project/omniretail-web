import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/* eslint-disable @next/next/no-img-element -- mock de next/image para inspeccionar sus props */

vi.mock("next/image", () => ({
  default: ({ unoptimized, src, alt }: { unoptimized?: boolean; src: string; alt: string }) => (
    <img alt={alt} data-unoptimized={String(Boolean(unoptimized))} src={src} />
  ),
}));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => ({ tenantId: "tenant-1" }),
}));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = { catalogImageAssets: { get: async () => null } };
  return { useRepositories: () => repositories };
});

import { StorefrontCatalogImage } from "@/modules/storefront/components/StorefrontCatalogImage";
import { CATALOG_IMAGE_FALLBACK } from "@/core/media/catalogImage";

function renderImage(source?: { kind: "url"; src: string }) {
  render(<StorefrontCatalogImage alt="Producto" height={100} source={source} width={100} />);
  return screen.getByAltText("Producto");
}

describe("StorefrontCatalogImage", () => {
  it.each([
    "/api/media/tenant/products/product/image.webp",
    "/images/products/taladro.webp",
  ])("optimiza las imagenes servidas por el frontend (%s)", (src) => {
    const image = renderImage({ kind: "url", src });
    expect(image.getAttribute("src")).toBe(src);
    expect(image.dataset.unoptimized).toBe("false");
  });

  it("sirve tal cual las URLs externas", () => {
    const image = renderImage({ kind: "url", src: "https://cdn.example.com/producto.png" });
    expect(image.dataset.unoptimized).toBe("true");
  });

  it("usa el placeholder optimizable cuando no hay fuente", () => {
    const image = renderImage();
    expect(image.getAttribute("src")).toBe(CATALOG_IMAGE_FALLBACK);
    expect(image.dataset.unoptimized).toBe("false");
  });

  it("reemplaza blobs por el placeholder en lugar de pasarlos al optimizador", () => {
    const image = renderImage({ kind: "url", src: "blob:http://localhost/123" });
    expect(image.getAttribute("src")).toBe(CATALOG_IMAGE_FALLBACK);
  });
});
