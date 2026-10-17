import { describe, expect, it } from "vitest";
import { resolveImageUrlInput } from "@/core/media/resolveImageUrlInput";

describe("resolveImageUrlInput", () => {
  it("trata el texto vacio o con espacios como campo vacio", () => {
    expect(resolveImageUrlInput("")).toEqual({ status: "empty" });
    expect(resolveImageUrlInput("   ")).toEqual({ status: "empty" });
  });

  it("acepta URLs http(s) y devuelve el valor sin espacios", () => {
    expect(resolveImageUrlInput("  https://cdn.example.com/logo.png ")).toEqual({
      status: "valid",
      src: "https://cdn.example.com/logo.png",
    });
    expect(resolveImageUrlInput("http://example.com/a.webp")).toEqual({
      status: "valid",
      src: "http://example.com/a.webp",
    });
  });

  it("acepta rutas same-origin seguras", () => {
    expect(resolveImageUrlInput("/media/logo.png")).toEqual({
      status: "valid",
      src: "/media/logo.png",
    });
  });

  it("rechaza texto incompleto, otros protocolos y rutas inseguras", () => {
    for (const raw of ["htt", "ftp://example.com/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "blob:x", "/../etc", "//evil.com/a.png"]) {
      expect(resolveImageUrlInput(raw)).toEqual({ status: "invalid" });
    }
  });
});
