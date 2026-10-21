import type { ShippingChannel, ShippingChannelConfig } from "@/core/entities";
import { SHIPPING_AMOUNT_MAX } from "@/config/shipping-policy";
import type {
  ShippingChannelFormValue,
  ShippingConfigDto,
  ShippingConfigFormValue,
  ShippingConfigInputDto,
} from "@/modules/administration/application/dto/ShippingConfigDto";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";

export const SHIPPING_CHANNELS: readonly ShippingChannel[] = ["ecommerce", "pos"];

type ShippingChannelField = "deliveryFee" | "freeShippingThreshold";
export type ShippingConfigFieldErrors = Partial<
  Record<`${ShippingChannel}.${ShippingChannelField}`, string>
>;

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

function amountError(value: string, label: string, required: boolean): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return required ? `${label} es requerida.` : undefined;
  if (!AMOUNT_PATTERN.test(trimmed)) {
    return `${label} debe ser un monto positivo con hasta 2 decimales.`;
  }
  if (Number(trimmed) > SHIPPING_AMOUNT_MAX) return `${label} supera el monto permitido.`;
  return undefined;
}

export function getShippingConfigFieldErrors(
  value: ShippingConfigFormValue,
): ShippingConfigFieldErrors {
  const errors: ShippingConfigFieldErrors = {};
  for (const channel of SHIPPING_CHANNELS) {
    // Un canal que no cobra envío tiene los campos deshabilitados: no se validan para no bloquear
    // el guardado con valores que el usuario no puede corregir.
    if (!value[channel].enabled) continue;
    const fee = amountError(value[channel].deliveryFee, "La tarifa de envío", true);
    if (fee) errors[`${channel}.deliveryFee`] = fee;
    const threshold = amountError(
      value[channel].freeShippingThreshold,
      "El monto para envío gratis",
      false,
    );
    if (threshold) errors[`${channel}.freeShippingThreshold`] = threshold;
  }
  return errors;
}

/** Monto válido del campo, o `undefined` si está vacío o no es un monto (solo en canales inactivos). */
function parseAmount(value: string): number | undefined {
  const trimmed = value.trim();
  return AMOUNT_PATTERN.test(trimmed) && Number(trimmed) <= SHIPPING_AMOUNT_MAX
    ? Number(trimmed)
    : undefined;
}

function toChannelInput(value: ShippingChannelFormValue): ShippingChannelConfig {
  // En un canal inactivo se conservan los montos válidos para cuando se reactive; el backend exige
  // una tarifa, así que una vacía se guarda como Q0.
  return {
    enabled: value.enabled,
    deliveryFee: parseAmount(value.deliveryFee) ?? 0,
    freeShippingThreshold: parseAmount(value.freeShippingThreshold),
  };
}

/** Valida en la capa de aplicación: la pantalla no es el único consumidor del service. */
export function toShippingConfigInput(value: ShippingConfigFormValue): ShippingConfigInputDto {
  const [firstError] = Object.values(getShippingConfigFieldErrors(value));
  if (firstError) throw new AdministrationServiceError(firstError);
  return { ecommerce: toChannelInput(value.ecommerce), pos: toChannelInput(value.pos) };
}

function toChannelFormValue(config: ShippingChannelConfig): ShippingChannelFormValue {
  return {
    enabled: config.enabled,
    deliveryFee: config.deliveryFee.toFixed(2),
    freeShippingThreshold:
      config.freeShippingThreshold === undefined ? "" : config.freeShippingThreshold.toFixed(2),
  };
}

export function toShippingConfigFormValue(config: ShippingConfigDto): ShippingConfigFormValue {
  return { ecommerce: toChannelFormValue(config.ecommerce), pos: toChannelFormValue(config.pos) };
}
