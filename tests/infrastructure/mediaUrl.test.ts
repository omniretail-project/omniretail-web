import { describe, expect, it } from "vitest";
import {
  isBackendManagedMediaUrl,
  toBackendMediaUrl,
  toSameOriginMediaUrl,
} from "@/infrastructure/api/mediaUrl";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OWNER = "22222222-2222-2222-2222-222222222222";
const FILE = "33333333-3333-3333-3333-333333333333";
const path = (scope: string, extension = "png") =>
  `/media/${TENANT}/${scope}/${OWNER}/${FILE}.${extension}`;

describe("mediaUrl", () => {
  it.each(["categories", "products", "ecommerce"])(
    "reconoce y resuelve por el proxy la zona %s",
    (scope) => {
      expect(isBackendManagedMediaUrl(path(scope))).toBe(true);
      expect(toSameOriginMediaUrl(path(scope))).toBe(
        `/api/media/${TENANT}/${scope}/${OWNER}/${FILE}.png`,
      );
    },
  );

  it("revierte la ruta del proxy a la del backend (para reenviarla en un PUT sin cambios)", () => {
    const proxied = toSameOriginMediaUrl(path("ecommerce", "webp"));

    expect(toBackendMediaUrl(proxied)).toBe(path("ecommerce", "webp"));
  });

  it("no toca URLs externas ni zonas o archivos no administrados", () => {
    for (const url of [
      "https://cdn.example.com/logo.png",
      path("branding"),
      path("ecommerce", "gif"),
      `/media/${TENANT}/ecommerce/${OWNER}/../${FILE}.png`,
      "/media/otra-cosa.png",
    ]) {
      expect(isBackendManagedMediaUrl(url)).toBe(false);
      expect(toSameOriginMediaUrl(url)).toBe(url);
    }
    expect(toBackendMediaUrl("/api/media/otra-cosa.png")).toBe("/api/media/otra-cosa.png");
    expect(toBackendMediaUrl("https://cdn.example.com/logo.png")).toBe(
      "https://cdn.example.com/logo.png",
    );
  });
});
