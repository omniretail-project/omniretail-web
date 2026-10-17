import type { BankAccountStatus, BankAccountType } from "@/core/entities";
import type { CurrencyCode } from "@/core/types/common.types";
import type { BankAccountInputDto } from "@/modules/administration/application/dto/BankAccountDto";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";
import { ADMIN_FIELD_LIMITS } from "@/modules/administration/validation/adminFieldConstraints";

const ACCOUNT_TYPES: readonly BankAccountType[] = ["monetary", "savings"];
const CURRENCIES: readonly string[] = ["GTQ", "USD"];
const STATUSES: readonly BankAccountStatus[] = ["active", "inactive", "archived"];
const LIMITS = ADMIN_FIELD_LIMITS.bankAccount;

const ACCOUNT_NUMBER_SEPARATORS = /[\s-]/g;
/**
 * El contrato todavía no define IBAN ni reglas por banco/país. Para esta primera capa se exige
 * solo dígitos, preservando ceros iniciales, y se aplica un máximo prudente documentado para
 * evitar entradas excesivas hasta que backend confirme reglas bancarias definitivas.
 */
const ACCOUNT_NUMBER_FORMAT = /^\d+$/;

/**
 * Quita separadores visuales ("1234 5678 9012" -> "123456789012") antes de validar o persistir.
 * `accountNumber` se guarda siempre normalizado.
 */
export function normalizeAccountNumber(value: string): string {
  return value.trim().replace(ACCOUNT_NUMBER_SEPARATORS, "");
}

function isValidAccountNumber(normalized: string): boolean {
  return ACCOUNT_NUMBER_FORMAT.test(normalized);
}

/**
 * Única función autorizada para producir `accountNumberMasked`. Conserva los últimos 4 caracteres
 * visibles y enmascara el resto (p. ej. "123456789012" -> "********9012"). Los services la llaman
 * siempre sobre un `accountNumber` ya normalizado; nunca se deriva de un valor recibido del DTO.
 */
export function maskAccountNumber(accountNumber: string): string {
  const visibleLength = Math.min(4, accountNumber.length);
  const visible = accountNumber.slice(accountNumber.length - visibleLength);
  return "*".repeat(accountNumber.length - visibleLength) + visible;
}

/**
 * Valida el DTO recibido antes de normalizarlo. Las reglas observan exactamente lo que envió el
 * consumidor: una UI oculta no impide que otro consumidor invoque el service con datos inválidos.
 *
 * `accountNumber` es la fuente de verdad, nunca `accountNumberMasked` (ese campo ya no es un input).
 * En alta (`mode: "create"`) es obligatorio. En edición (`mode: "update"`) un valor vacío significa
 * "conservar el número actual" y no se rechaza como ausente; si viene con contenido, se valida igual
 * que en alta.
 */
export function validateBankAccountInput(dto: BankAccountInputDto, mode: "create" | "update") {
  const bankName = dto.bankName.trim();
  const holderName = dto.holderName.trim();
  if (!bankName) {
    throw new AdministrationServiceError("El banco es obligatorio.");
  }
  if (bankName.length > LIMITS.bankName) {
    throw new AdministrationServiceError("El banco no puede exceder 80 caracteres.");
  }
  if (!holderName) {
    throw new AdministrationServiceError("El titular de la cuenta es obligatorio.");
  }
  if (holderName.length > LIMITS.holderName) {
    throw new AdministrationServiceError(
      "El titular de la cuenta no puede exceder 120 caracteres.",
    );
  }

  const accountNumberProvided = dto.accountNumber.trim().length > 0;
  if (mode === "create" && !accountNumberProvided) {
    throw new AdministrationServiceError("El número de cuenta es obligatorio.");
  }
  const normalizedAccountNumber = normalizeAccountNumber(dto.accountNumber);
  if (accountNumberProvided && !isValidAccountNumber(normalizedAccountNumber)) {
    throw new AdministrationServiceError(
      "El número de cuenta no es válido. Ingresa solo dígitos, sin letras.",
    );
  }
  if (accountNumberProvided && normalizedAccountNumber.length > LIMITS.accountNumber) {
    throw new AdministrationServiceError("El número de cuenta no puede exceder 24 dígitos.");
  }

  const alias = dto.alias.trim();
  if (!alias) {
    throw new AdministrationServiceError("El alias de la cuenta es obligatorio.");
  }
  if (alias.length > LIMITS.alias) {
    throw new AdministrationServiceError("El alias de la cuenta no puede exceder 50 caracteres.");
  }
  const transferInstructions = dto.transferInstructions?.trim();
  if (transferInstructions && transferInstructions.length > LIMITS.transferInstructions) {
    throw new AdministrationServiceError(
      "Las instrucciones de transferencia no pueden exceder 300 caracteres.",
    );
  }
  if (!ACCOUNT_TYPES.includes(dto.accountType)) {
    throw new AdministrationServiceError("El tipo de cuenta no es válido.");
  }
  if (!CURRENCIES.includes(dto.currency)) {
    throw new AdministrationServiceError("La moneda no es válida.");
  }
  if (!STATUSES.includes(dto.status)) {
    throw new AdministrationServiceError("El estado de la cuenta no es válido.");
  }
  if (!Array.isArray(dto.branchIds) || dto.branchIds.some((id) => !id.trim())) {
    throw new AdministrationServiceError("Las sucursales habilitadas no son válidas.");
  }
}

export interface NormalizedBankAccountInput {
  bankName: string;
  holderName: string;
  /** Ausente cuando el DTO llegó vacío en edición: el service conserva el número actual. */
  accountNumber?: string;
  accountType: BankAccountType;
  currency: CurrencyCode;
  alias: string;
  branchIds: string[];
  transferInstructions?: string;
  status: BankAccountStatus;
}

/**
 * Normaliza el input ya validado. Deliberadamente NO devuelve `accountNumberMasked`: ese valor se
 * deriva en el service (`maskAccountNumber`) sobre el `accountNumber` final (nuevo o conservado),
 * nunca acá.
 */
export function normalizeBankAccountInput(dto: BankAccountInputDto): NormalizedBankAccountInput {
  const transferInstructions = dto.transferInstructions?.trim();
  const accountNumber = dto.accountNumber.trim()
    ? normalizeAccountNumber(dto.accountNumber)
    : undefined;

  return {
    bankName: dto.bankName.trim(),
    holderName: dto.holderName.trim(),
    accountNumber,
    accountType: dto.accountType,
    currency: dto.currency,
    alias: dto.alias.trim(),
    branchIds: Array.from(new Set(dto.branchIds.map((id) => id.trim()).filter(Boolean))),
    transferInstructions: transferInstructions || undefined,
    status: dto.status,
  };
}
