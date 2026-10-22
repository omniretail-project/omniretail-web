import { describe, expect, it, vi } from "vitest";
import { LocationStatus, ProductStatus } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ArchiveProductService } from "@/modules/catalog/application/services/ArchiveProductService";
import {
  getArchiveErrorMessage,
  translateArchiveError,
} from "@/modules/catalog/application/services/archiveErrors";
import { SaveCategoryService } from "@/modules/catalog/application/services/SaveCategoryService";
import {
  ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE,
  SaveLocationService,
} from "@/modules/catalog/application/services/SaveLocationService";
import { CatalogServiceError } from "@/modules/catalog/application/services/serviceHelpers";

const permissionsState = vi.hoisted(() => ({ current: [] as string[] }));

vi.mock("@/modules/catalog/application/services/serviceHelpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/catalog/application/services/serviceHelpers")>()),
  resolveTenantContext: async () => ({ tenantId: "tenant-1", permissions: permissionsState.current }),
}));

function conflict(code: string, serverMessage = "texto interno del backend") {
  return new BackendRequestError(serverMessage, 409, code);
}

describe("translateArchiveError", () => {
  it.each([
    ["PRODUCT_ARCHIVE_HAS_STOCK", /existencias o reservas en al menos una sucursal/],
    ["PRODUCT_ARCHIVE_HAS_OPEN_PO", /órdenes de compra abiertas/],
    ["PRODUCT_ARCHIVE_IN_TRANSIT", /traslado ya despachado/],
    ["KIT_COMPONENT_IN_USE", /componente de un kit publicado/],
    ["CATEGORY_HAS_PRODUCTS", /productos no archivados asociados directamente/],
    ["CATEGORY_HAS_ACTIVE_CHILDREN", /subcategorías activas/],
  ])("turns %s into a clear message and hides the backend text", (code, expected) => {
    const translated = translateArchiveError(conflict(code));

    expect(translated).toBeInstanceOf(CatalogServiceError);
    expect((translated as Error).message).toMatch(expected);
    expect((translated as Error).message).not.toContain("texto interno del backend");
    expect(getArchiveErrorMessage(code)).toBe((translated as Error).message);
  });

  it("keeps unknown codes, other statuses and non-backend errors untouched", () => {
    const unknown = conflict("OTRO_CODIGO");
    const forbidden = new BackendRequestError("Sin acceso", 403, "ACCESS_DENIED");
    const plain = new Error("fallo de red");

    expect(translateArchiveError(unknown)).toBe(unknown);
    expect(translateArchiveError(forbidden)).toBe(forbidden);
    expect(translateArchiveError(plain)).toBe(plain);
    expect(getArchiveErrorMessage("OTRO_CODIGO")).toBeUndefined();
  });

  it("explains that archiving a product is global", () => {
    expect(getArchiveErrorMessage("PRODUCT_ARCHIVE_HAS_STOCK")).toMatch(/todo el negocio/);
  });
});

describe("ArchiveProductService rejections", () => {
  function registry(archiveScoped: ReturnType<typeof vi.fn>) {
    return { products: { archiveScoped } } as unknown as RepositoryRegistry;
  }

  it("archives and returns the product when the backend accepts", async () => {
    permissionsState.current = ["catalog.products.update"];
    const archived = { id: "p1", status: ProductStatus.archived };
    const archiveScoped = vi.fn(async () => archived);

    await expect(new ArchiveProductService(registry(archiveScoped)).execute("p1")).resolves.toBe(archived);
    expect(archiveScoped).toHaveBeenCalledWith("tenant-1", "p1");
  });

  it.each([
    "PRODUCT_ARCHIVE_HAS_STOCK",
    "PRODUCT_ARCHIVE_HAS_OPEN_PO",
    "PRODUCT_ARCHIVE_IN_TRANSIT",
    "KIT_COMPONENT_IN_USE",
  ])("rejects with the specific message for %s so the caller keeps the product unarchived", async (code) => {
    permissionsState.current = ["catalog.products.update"];
    const service = new ArchiveProductService(registry(vi.fn().mockRejectedValue(conflict(code))));

    await expect(service.execute("p1")).rejects.toThrow(getArchiveErrorMessage(code) as string);
  });

  it("still reports a missing product, whatever the tenant", async () => {
    permissionsState.current = ["catalog.products.update"];
    const service = new ArchiveProductService(
      registry(vi.fn().mockRejectedValue(new BackendRequestError("x", 404, "PRODUCT_NOT_FOUND"))),
    );

    await expect(service.execute("p1")).rejects.toThrow("El producto solicitado no existe.");
  });

  it("propagates unknown failures unchanged", async () => {
    permissionsState.current = ["catalog.products.update"];
    const failure = new BackendRequestError("Error interno", 500, "INTERNAL");
    const service = new ArchiveProductService(registry(vi.fn().mockRejectedValue(failure)));

    await expect(service.execute("p1")).rejects.toBe(failure);
  });

  it("does not call the backend without permission to update products", async () => {
    permissionsState.current = [];
    const archiveScoped = vi.fn();

    await expect(new ArchiveProductService(registry(archiveScoped)).execute("p1")).rejects.toThrow(
      /permisos/,
    );
    expect(archiveScoped).not.toHaveBeenCalled();
  });
});

describe("SaveCategoryService.archive rejections", () => {
  function registry(archiveScoped: ReturnType<typeof vi.fn>) {
    return { categories: { archiveScoped } } as unknown as RepositoryRegistry;
  }

  it("archives when the backend answers 204", async () => {
    permissionsState.current = ["catalog.categories.manage"];
    const archived = { id: "c1", status: "archived" };
    const archiveScoped = vi.fn(async () => archived);

    await expect(new SaveCategoryService(registry(archiveScoped)).archive("c1")).resolves.toBe(archived);
  });

  it.each(["CATEGORY_HAS_PRODUCTS", "CATEGORY_HAS_ACTIVE_CHILDREN"])(
    "rejects with the specific message for %s",
    async (code) => {
      permissionsState.current = ["catalog.categories.manage"];
      const service = new SaveCategoryService(registry(vi.fn().mockRejectedValue(conflict(code))));

      await expect(service.archive("c1")).rejects.toThrow(getArchiveErrorMessage(code) as string);
    },
  );

  it("requires permission to manage categories", async () => {
    permissionsState.current = ["catalog.categories.read"];
    const archiveScoped = vi.fn();

    await expect(new SaveCategoryService(registry(archiveScoped)).archive("c1")).rejects.toThrow(
      /permisos/,
    );
    expect(archiveScoped).not.toHaveBeenCalled();
  });
});

describe("SaveLocationService.archive rejections", () => {
  it("explains that products must be reassigned, without suggesting an unassignment", async () => {
    permissionsState.current = ["catalog.locations.manage"];
    const updateLocation = vi.fn().mockRejectedValue(conflict("LOCATION_ASSIGNED_TO_PRODUCTS"));
    const service = new SaveLocationService({
      inventory: { updateLocation },
    } as unknown as RepositoryRegistry);

    await expect(service.archive("l1")).rejects.toThrow(ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE);
    expect(ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE).toMatch(
      /Reasigna esos productos a otra ubicación activa/,
    );
    expect(ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE).not.toMatch(/Desasigna/);
    expect(updateLocation).toHaveBeenCalledWith("l1", { status: LocationStatus.archived });
  });
});
