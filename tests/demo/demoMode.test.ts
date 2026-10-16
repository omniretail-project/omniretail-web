import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDemoContractUrl,
  getMarketingSiteUrl,
  getPublicDemoUrl,
  isPublicDemo,
} from "@/config/demo-mode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPublicDemo", () => {
  const cases: Array<[string | undefined, string | undefined, boolean]> = [
    ["true", "mock", true],
    ["true", undefined, true],
    ["true", "api", false],
    ["false", "mock", false],
    [undefined, "mock", false],
    ["TRUE", "mock", false],
    [undefined, undefined, false],
  ];

  it.each(cases)("PUBLIC_DEMO=%s API_MODE=%s -> %s", (flag, mode, expected) => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", flag as string);
    vi.stubEnv("NEXT_PUBLIC_API_MODE", mode as string);
    if (flag === undefined) delete process.env.NEXT_PUBLIC_PUBLIC_DEMO;
    if (mode === undefined) delete process.env.NEXT_PUBLIC_API_MODE;
    expect(isPublicDemo()).toBe(expected);
  });
});

describe("demo urls", () => {
  it("normalizes trailing slashes and returns empty when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://marjym.example/");
    vi.stubEnv("NEXT_PUBLIC_DEMO_URL", "");
    expect(getMarketingSiteUrl()).toBe("https://marjym.example");
    expect(getDemoContractUrl()).toBe("https://marjym.example/contratar");
    expect(getPublicDemoUrl()).toBe("");
  });

  it("has no contract url without marketing url", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
    expect(getDemoContractUrl()).toBe("");
  });
});
