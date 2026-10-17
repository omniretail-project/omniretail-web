import { BackendRequestError } from "@/infrastructure/api/backendClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los ids del backend son UUID; cualquier otro (p. ej. un id del mock) no puede existir alli. */
export function isApiUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function assertApiUuid(value: string, fieldName: string): void {
  if (isApiUuid(value)) return;
  throw new BackendRequestError(
    `${fieldName} debe ser un UUID válido del backend.`,
    400,
    "INVALID_UUID",
    { [fieldName]: "Debe ser un UUID válido." },
  );
}

export function assertOptionalApiUuid(value: string | null | undefined, fieldName: string): void {
  if (value == null || value === "") return;
  assertApiUuid(value, fieldName);
}
