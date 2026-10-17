import type { BankAccount } from "@/core/entities";

/**
 * Proyección de lectura (listado y edición). Incluye `accountNumber` completo para que el
 * administrador pueda verlo en el detalle. El listado muestra ambos: el completo y el enmascarado.
 */
export type BankAccountDto = Omit<BankAccount, "tenantId">;

/**
 * Input de alta/edición. `accountNumber` es la única fuente de verdad: `accountNumberMasked` se
 * deriva del lado del service (`maskAccountNumber`) y nunca se acepta como campo editable acá.
 * En alta es obligatorio; en edición un valor vacío significa "conservar el número actual".
 */
export type BankAccountInputDto = Pick<
  BankAccount,
  | "bankName"
  | "holderName"
  | "accountNumber"
  | "accountType"
  | "currency"
  | "alias"
  | "branchIds"
  | "transferInstructions"
  | "status"
>;
