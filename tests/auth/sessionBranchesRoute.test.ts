import { describe, expect, it, vi } from "vitest";
import { relaySessionRequest } from "@/app/api/_lib/backend";
import { GET } from "@/app/api/auth/session/branches/route";

vi.mock("@/app/api/_lib/backend", () => ({
  relaySessionRequest: vi.fn().mockResolvedValue(new Response("[]")),
}));

describe("GET /api/auth/session/branches", () => {
  it("reenvia la lectura al endpoint de sucursales asignadas de la sesion", async () => {
    const request = new Request("http://localhost/api/auth/session/branches") as never;

    const response = await GET(request);

    expect(relaySessionRequest).toHaveBeenCalledWith(request, "/auth/session/branches", "GET");
    expect(await response.text()).toBe("[]");
  });
});
