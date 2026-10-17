export function normalizeSku(value: string) {
  return value.trim().replace(/\s+/g, "-").toUpperCase();
}
