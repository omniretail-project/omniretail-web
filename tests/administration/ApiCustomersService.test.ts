import { beforeEach, describe, expect, it, vi } from "vitest";
import { backendFetch } from "@/infrastructure/api/backendClient";
import { ApiCustomersService } from "@/modules/administration/application/services/ApiCustomersService";

vi.mock("@/infrastructure/api/backendClient", () => ({ backendFetch: vi.fn() }));

describe("ApiCustomersService", () => {
  beforeEach(() => {
    vi.mocked(backendFetch).mockReset();
  });

  it("consulta /administration/customers y mapea la respuesta al DTO", async () => {
    vi.mocked(backendFetch).mockResolvedValue([
      {
        id: "c1",
        userId: "u1",
        code: "CLI-1",
        name: "Melbyn Xutuc",
        email: "m@example.com",
        phone: "5555-1111",
        segmentId: "s1",
        status: "active",
        createdAt: "2026-10-07T10:00:00Z",
        updatedAt: "2026-10-07T10:00:00Z",
        purchaseCount: 2,
        topProducts: [{ productName: "Martillo", totalQuantity: "3.5" }],
      },
    ]);

    const customers = await new ApiCustomersService().list();

    expect(backendFetch).toHaveBeenCalledWith("/administration/customers");
    expect(customers).toEqual([
      {
        id: "c1",
        userId: "u1",
        code: "CLI-1",
        name: "Melbyn Xutuc",
        email: "m@example.com",
        phone: "5555-1111",
        segmentId: "s1",
        status: "active",
        createdAt: "2026-10-07T10:00:00Z",
        updatedAt: "2026-10-07T10:00:00Z",
        purchaseCount: 2,
        topProducts: [{ productName: "Martillo", totalQuantity: 3.5 }],
      },
    ]);
  });

  it("convierte null en undefined y topProducts ausente en lista vacia", async () => {
    vi.mocked(backendFetch).mockResolvedValue([
      {
        id: "c2",
        userId: null,
        code: "CLI-2",
        name: "Cliente Google",
        email: "g@example.com",
        phone: null,
        segmentId: null,
        status: "inactive",
        createdAt: "2026-10-08T10:00:00Z",
        updatedAt: "2026-10-08T10:00:00Z",
        purchaseCount: 0,
        topProducts: null,
      },
    ]);

    const [customer] = await new ApiCustomersService().list();

    expect(customer.userId).toBeUndefined();
    expect(customer.phone).toBeUndefined();
    expect(customer.segmentId).toBeUndefined();
    expect(customer.topProducts).toEqual([]);
    expect(customer.purchaseCount).toBe(0);
  });

  it("propaga el error del backend", async () => {
    vi.mocked(backendFetch).mockRejectedValue(new Error("403"));
    await expect(new ApiCustomersService().list()).rejects.toThrow("403");
  });
});
