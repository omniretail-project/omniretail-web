export const EXPIRATION_BEFORE_ENTRY_MESSAGE =
  "La fecha de caducidad no puede ser anterior a la fecha de ingreso.";

export function isExpirationBeforeOperationDate(
  expirationDate: string,
  operationDate: string,
): boolean {
  const expiration = toCalendarDate(expirationDate);
  const operation = toCalendarDate(operationDate);
  return Boolean(expiration && operation && expiration < operation);
}

export function getLocalCalendarDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toCalendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}
