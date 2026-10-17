import { describe, expect, it, vi } from "vitest";
import { relaySessionRequest } from "@/app/api/_lib/backend";
import { GET } from "@/app/api/auth/session/entitlements/route";

vi.mock("@/app/api/_lib/backend", () => ({
  relaySessionRequest: vi.fn().mockResolvedValue(new Response("{}")),
}));

describe("GET /api/auth/session/entitlements", () => {
  it("reenvia la peticion de sesion al endpoint de entitlements del backend", async () => {
    const request = new Request("http://localhost/api/auth/session/entitlements") as never;

    await GET(request);

    expect(relaySessionRequest).toHaveBeenCalledWith(request, "/auth/session/entitlements", "GET");
  });
});
