import { describe, expect, it } from "vitest";
import { ApiAuthRepository } from "@/infrastructure/api/ApiAuthRepository";

describe("ApiAuthRepository.revokeAllSessionsByUserId", () => {
  it("resuelve sin error: en modo api el backend ya revoca las sesiones al cambiar rol, estado o sucursales", async () => {
    const repository = new ApiAuthRepository({} as never, {} as never, {} as never);

    await expect(repository.revokeAllSessionsByUserId()).resolves.toBeUndefined();
  });
});
