import { describe, expect, it } from "vitest";
import {
  CUSTOMER_PASSWORD_POLICY,
  EMPLOYEE_PASSWORD_POLICY,
  getPasswordRequirementsMessage,
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
