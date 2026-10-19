import { describe, expect, it } from "vitest";
import { CONSENT_VERSION } from "@/modules/information-request/application/dto/InformationRequestDto";
import { informationRequestSchema } from "@/modules/information-request/validation/informationRequest.schema";

const validRequest = {
  fullName: "Ana Pérez",
  businessName: "Ferretería O'Connor",
  email: "ana@example.com",
  phone: "+502 1234 5678",
  industry: "hardware",
  modules: ["inventory", "pos"],
  message: "Necesitamos atender dos sucursales.",
  consentAccepted: true,
  consentVersion: CONSENT_VERSION,
  website: "",
  captchaToken: "",
};

function parses(overrides: Record<string, unknown> = {}) {
  return informationRequestSchema.safeParse({ ...validRequest, ...overrides });
}

describe("informationRequestSchema", () => {
  it("acepta los límites exactos y nombres Unicode legítimos", () => {
    expect(parses({ fullName: "Ña", businessName: "Óx" }).success).toBe(true);
    expect(parses({ fullName: "Á".repeat(100) }).success).toBe(true);
    expect(parses({ businessName: "B".repeat(120) }).success).toBe(true);
    expect(parses({ email: `${"a".repeat(242)}@example.com` }).success).toBe(true);
    expect(parses({ phone: "1234567" }).success).toBe(true);
    expect(parses({ phone: "1".repeat(20) }).success).toBe(true);
    expect(parses({ message: "M".repeat(1000) }).success).toBe(true);
  });

  it.each([
    ["fullName", "A"],
    ["fullName", "A".repeat(101)],
    ["businessName", "B"],
    ["businessName", "B".repeat(121)],
    ["email", `${"a".repeat(243)}@example.com`],
    ["phone", "123456"],
    ["phone", "1".repeat(21)],
    ["phone", "502-ABC-1234"],
    ["phone", "123.456"],
    ["message", "M".repeat(1001)],
  ])("rechaza %s fuera de contrato", (field, value) => {
    expect(parses({ [field]: value }).success).toBe(false);
  });

  it("rechaza rubros, módulos, duplicados y consentimiento fuera de contrato", () => {
    expect(parses({ modules: ["catalog.kits"] }).success).toBe(true);
    expect(parses({ industry: "unknown" }).success).toBe(false);
    expect(parses({ modules: [] }).success).toBe(false);
    expect(parses({ modules: ["inventory", "unknown"] }).success).toBe(false);
    expect(parses({ modules: ["inventory", "inventory"] }).success).toBe(false);
    expect(parses({ consentAccepted: false }).success).toBe(false);
  });

  it.each(["fullName", "businessName", "email", "phone", "message"])(
    "rechaza controles en %s antes de normalizar",
    (field) => {
      const original = String(validRequest[field as keyof typeof validRequest]);
      expect(parses({ [field]: `${original}\u0000` }).success).toBe(false);
    },
  );

  it("permite saltos de línea en comentarios y rechaza controles de formato en una sola línea", () => {
    expect(parses({ message: "Primera línea\nSegunda línea" }).success).toBe(true);
    expect(parses({ fullName: "Ana\u200BPérez" }).success).toBe(false);
  });

  it("normaliza espacios y correo sin restringir tildes ni apóstrofes", () => {
    const result = parses({
      fullName: "  Zoë D'Ávila  ",
      businessName: "  Café L'Étoile  ",
      email: "  ANA@EXAMPLE.COM  ",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      fullName: "Zoë D'Ávila",
      businessName: "Café L'Étoile",
      email: "ana@example.com",
    });
  });
});
