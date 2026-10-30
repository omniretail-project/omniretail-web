import { describe, expect, it } from "vitest";
import {
  CUSTOMER_NAME_MESSAGES,
  normalizePersonName,
  validateCustomerName,
} from "@/config/person-name-policy";
import {
  EMAIL_MAX_LENGTH,
  normalizeRegisterEmail,
  validateRegisterForm,
} from "@/modules/auth/validation/register.validation";
import { isValidRecipientName, sanitizeRecipientName } from "@/config/delivery-address-policy";

const validForm = {
  name: "Ana Pérez",
  email: "ana@tienda.test",
  phone: "",
  password: "ClienteNuevo1!",
  confirmPassword: "ClienteNuevo1!",
};

describe("normalizePersonName", () => {
  it("compone los acentos en NFC (una sola letra en vez de letra + acento combinado)", () => {
    const decomposed = "José Pérez";
    expect(normalizePersonName(decomposed)).toBe("José Pérez");
    expect(normalizePersonName(decomposed)).toHaveLength("José Pérez".length);
  });

  it("convierte apostrofos y guiones tipograficos y junta espacios repetidos", () => {
    expect(normalizePersonName("  María   O’Neil–Ruiz  ")).toBe("María O'Neil-Ruiz");
  });

  it("no convierte saltos de linea ni tabs en espacios: se rechazan despues", () => {
    expect(normalizePersonName("Ana\nPérez")).toBe("Ana\nPérez");
    expect(normalizePersonName("Ana\tPérez")).toBe("Ana\tPérez");
  });
});

describe("validateCustomerName", () => {
  it.each(["Ana", "José Pérez", "María O'Neil", "Ana-Lucía", "Zoë Ñúñez", "Łukasz Wójcik"])(
    "acepta nombres reales: %s",
    (name) => {
      expect(validateCustomerName(normalizePersonName(name))).toBeNull();
    },
  );

  it.each([
    ["<script>alert(1)</script>"],
    ["Ana<b>"],
    ["Ana & Luis"],
    ["Robert'); DROP TABLE users;--"],
    ["Ana2"],
    ["Ana\u0000Pérez"],
    ["Ana\nPérez"],
    ["Ana\u001bPérez"],
    ["Ana​Pérez"],
    ["Ana‮Pérez"],
    ["Ana  -  Pérez"],
    ["-Ana"],
    ["Ana'"],
  ])("rechaza %j", (name) => {
    expect(validateCustomerName(normalizePersonName(name))).toBe(CUSTOMER_NAME_MESSAGES.invalid);
  });

  it("exige el nombre y respeta el largo maximo de 100", () => {
    expect(validateCustomerName(normalizePersonName("   "))).toBe(CUSTOMER_NAME_MESSAGES.required);
    expect(validateCustomerName("A".repeat(100))).toBeNull();
    expect(validateCustomerName("A".repeat(101))).toBe(CUSTOMER_NAME_MESSAGES.tooLong);
  });
});

describe("validateRegisterForm", () => {
  it("acepta un registro valido", () => {
    expect(validateRegisterForm(validForm)).toEqual({});
  });

  it("rechaza HTML en el nombre con el mensaje de la politica", () => {
    expect(validateRegisterForm({ ...validForm, name: "<img src=x onerror=alert(1)>" }).name).toBe(
      CUSTOMER_NAME_MESSAGES.invalid,
    );
  });

  it("normaliza el correo a minusculas antes de validar", () => {
    expect(normalizeRegisterEmail("  Ana.Perez@Tienda.TEST ")).toBe("ana.perez@tienda.test");
    expect(validateRegisterForm({ ...validForm, email: "  Ana@Tienda.TEST " }).email).toBeUndefined();
  });

  it("rechaza un correo vacio, invalido o demasiado largo", () => {
    expect(validateRegisterForm({ ...validForm, email: " " }).email).toBe("El correo es obligatorio.");
    expect(validateRegisterForm({ ...validForm, email: "ana@tienda" }).email).toBe(
      "Ingrese un correo con formato válido.",
    );
    const tooLong = `${"a".repeat(EMAIL_MAX_LENGTH)}@x.co`;
    expect(validateRegisterForm({ ...validForm, email: tooLong }).email).toBe(
      `El correo no puede superar ${EMAIL_MAX_LENGTH} caracteres.`,
    );
  });
});

describe("politica de destinatario de entregas (misma regla extraida)", () => {
  it("conserva su comportamiento", () => {
    expect(sanitizeRecipientName("  Ana<script>   O’Neil  ")).toBe(" Anascript O'Neil ");
    expect(isValidRecipientName("Ana O'Neil")).toBe(true);
    expect(isValidRecipientName("Ana2")).toBe(false);
  });
});
