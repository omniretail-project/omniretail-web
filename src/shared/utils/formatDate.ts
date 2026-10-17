import type { ISODateString } from "@/core/types/common.types";

export function formatDate(value: ISODateString, locale = "es-GT") {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
