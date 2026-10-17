export function formatNumber(value: number, locale = "es-GT") {
  return new Intl.NumberFormat(locale).format(value);
}
