import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("next.config", () => {
  it("no envia la cabecera X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
