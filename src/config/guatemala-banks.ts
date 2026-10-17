/**
 * Lista cerrada de bancos emisores para el campo "Banco emisor" de un
 * método de pago guardado. Guatemala tiene varios bancos comerciales
 * distintos -- sin esta lista, el método de pago no indicaba de qué
 * banco era la tarjeta.
 */
export const GUATEMALA_BANKS = [
  "Banco Industrial",
  "Banco G&T Continental",
  "Banco de Desarrollo Rural (BANRURAL)",
  "BAC Credomatic",
  "Banco Agromercantil (BAM)",
  "Banco Promerica",
  "Banco Azteca",
  "VivaBanco",
  "Banco Ficohsa",
] as const;

export type GuatemalaBank = (typeof GUATEMALA_BANKS)[number];
