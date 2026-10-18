import { describe, expect, it } from "vitest";
import {
  CUSTOMER_PASSWORD_POLICY,
  EMPLOYEE_PASSWORD_POLICY,
  getPasswordRequirementsMessage,
  PASSWORD_TOO_MANY_BYTES_MESSAGE,
  validateCustomerPassword,
  validateEmployeePassword,
} from "@/config/auth-policy";

/** Contraseña valida (mayuscula, minuscula, numero y especial) del largo pedido. */
function passwordOfLength(length: number): string {
  return `Aa1!${"b".repeat(length - 4)}`;
}

describe("largo maximo de contraseña: 64, igual que el backend", () => {
  it("cliente y empleado comparten el maximo de 64", () => {
    expect(CUSTOMER_PASSWORD_POLICY.MAX_LENGTH).toBe(64);
    expect(EMPLOYEE_PASSWORD_POLICY.MAX_LENGTH).toBe(64);
  });

  it.each([
    ["cliente", validateCustomerPassword],
    ["empleado", validateEmployeePassword],
  ])("%s: 64 caracteres se aceptan y 65 se rechazan", (_kind, validate) => {
    expect(validate(passwordOfLength(64))).toBeNull();
    expect(validate(passwordOfLength(65))).not.toBeNull();
  });

  it("una contraseña de 25 a 64 caracteres ya no se rechaza (antes el maximo era 24)", () => {
    expect(validateCustomerPassword(passwordOfLength(25))).toBeNull();
    expect(validateEmployeePassword(passwordOfLength(40))).toBeNull();
  });

  it("el mensaje de requisitos muestra el nuevo maximo", () => {
    expect(getPasswordRequirementsMessage(CUSTOMER_PASSWORD_POLICY)).toContain("entre 8 y 64 caracteres");
    expect(getPasswordRequirementsMessage(EMPLOYEE_PASSWORD_POLICY)).toContain("entre 12 y 64 caracteres");
    expect(validateCustomerPassword(passwordOfLength(65))).toBe(
      getPasswordRequirementsMessage(CUSTOMER_PASSWORD_POLICY),
    );
  });
});

describe("largo maximo en bytes: 72 en UTF-8 (limite de BCrypt), igual que el backend", () => {
  const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

  it("72 bytes se aceptan y 73 se rechazan con el mensaje del backend", () => {
    const seventyTwo = `Aa1!${"ñ".repeat(34)}`;
    const seventyThree = `Aa1!b${"ñ".repeat(34)}`;
    expect(utf8Bytes(seventyTwo)).toBe(72);
    expect(utf8Bytes(seventyThree)).toBe(73);

    expect(validateCustomerPassword(seventyTwo)).toBeNull();
    expect(validateCustomerPassword(seventyThree)).toBe(PASSWORD_TOO_MANY_BYTES_MESSAGE);
    expect(validateEmployeePassword(seventyThree)).toBe(PASSWORD_TOO_MANY_BYTES_MESSAGE);
  });

  it("una contraseña con tildes de 64 caracteres o menos puede pasarse de 72 bytes", () => {
    const withAccents = `Aa1!${"á".repeat(40)}`;
    expect(withAccents.length).toBeLessThanOrEqual(64);
    expect(utf8Bytes(withAccents)).toBeGreaterThan(72);

    expect(validateCustomerPassword(withAccents)).toBe(PASSWORD_TOO_MANY_BYTES_MESSAGE);
  });

  it("los emojis cuentan 4 bytes cada uno", () => {
    expect(validateCustomerPassword(`Aa1!${"😀".repeat(17)}`)).toBeNull();
    expect(validateCustomerPassword(`Aa1!${"😀".repeat(18)}`)).toBe(PASSWORD_TOO_MANY_BYTES_MESSAGE);
  });

  it("64 caracteres ASCII siguen siendo validos (64 bytes)", () => {
    expect(validateEmployeePassword(passwordOfLength(64))).toBeNull();
  });

  it("mas de 64 caracteres sigue mostrando el mensaje de requisitos, no el de bytes", () => {
    expect(validateCustomerPassword(passwordOfLength(65))).toBe(
      getPasswordRequirementsMessage(CUSTOMER_PASSWORD_POLICY),
    );
  });
});
