import { describe, expect, it } from "vitest";
import { compareNullableText } from "@/modules/logistics/application/pickingPhysicalSelection";

describe("compareNullableText", () => {
  it("trata null y undefined como valores ausentes equivalentes", () => {
    expect(compareNullableText(null, null)).toBe(0);
    expect(compareNullableText(undefined, undefined)).toBe(0);
    expect(compareNullableText(null, undefined)).toBe(0);
    expect(compareNullableText(undefined, null)).toBe(0);
  });

  it("ordena los valores ausentes despues de las cadenas validas", () => {
    expect(compareNullableText(null, "2027-11-17")).toBeGreaterThan(0);
    expect(compareNullableText(undefined, "2027-11-17")).toBeGreaterThan(0);
    expect(compareNullableText("2027-11-17", null)).toBeLessThan(0);
    expect(compareNullableText("2027-11-17", undefined)).toBeLessThan(0);
  });

  it("mantiene localeCompare para cadenas validas", () => {
    expect(compareNullableText("2027-03-13", "2027-11-17")).toBeLessThan(0);
    expect(compareNullableText("2027-11-17", "2027-03-13")).toBeGreaterThan(0);
    expect(compareNullableText("2027-11-17", "2027-11-17")).toBe(0);
  });
});
