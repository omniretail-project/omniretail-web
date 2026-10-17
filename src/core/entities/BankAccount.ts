import type { CurrencyCode, ISODateString } from "@/core/types/common.types";

export type BankAccountType = "monetary" | "savings";
export type BankAccountStatus = "active" | "inactive" | "archived";

export interface BankAccount {
  id: string;
  tenantId: string;
  bankName: string;
  holderName: string;
  /**
   * Número de cuenta completo. Fuente de verdad; necesario para futuros flujos de
   * transferencia/depósito. En el backend real debe almacenarse protegido/cifrado; en el mock
   * actual se persiste en texto plano porque el store es ficticio (ver README del módulo).
   */
  accountNumber: string;
  /**
   * Representación enmascarada, derivada SIEMPRE de `accountNumber` (ver `maskAccountNumber`).
   * Nunca se acepta como input independiente: evita que quede desincronizada del número real.
   */
  accountNumberMasked: string;
  accountType: BankAccountType;
  currency: CurrencyCode;
  alias: string;
  branchIds: string[];
  transferInstructions?: string;
  status: BankAccountStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
