import { describe, expect, it } from "vitest";
import { validateChangePasswordForm as validateEmployeeForm } from "@/modules/auth/validation/changePassword.validation";
import { validateChangePasswordForm as validateCustomerForm } from "@/modules/customer/validation/changePassword.validation";

// 8 caracteres y cumple el resto de la politica: valida para cliente (minimo 8), no para empleado (12).
const EIGHT_CHARS = "Abcdef1!";
const TWELVE_CHARS = "Abcdefghi12!";

function form(newPassword: string) {
  return { currentPassword: "Actual123!x", newPassword, confirmNewPassword: newPassword };
}

describe("cambio de contraseña: cada tipo de cuenta usa su politica (igual que el backend)", () => {
  it("un cliente con una contraseña nueva de 8 caracteres que cumple la politica se acepta", () => {
    expect(validateCustomerForm(form(EIGHT_CHARS))).toEqual({});
  });

  it("un empleado con 8 caracteres se rechaza (minimo 12)", () => {
    expect(validateEmployeeForm(form(EIGHT_CHARS)).newPassword).toContain("entre 12 y");
  });

  it("un empleado con 12 caracteres que cumple la politica se acepta", () => {
    expect(validateEmployeeForm(form(TWELVE_CHARS))).toEqual({});
  });

  it("un cliente con 7 caracteres se rechaza con el mensaje de la politica de cliente", () => {
    expect(validateCustomerForm(form("Abcde1!")).newPassword).toContain("entre 8 y");
  });
});
