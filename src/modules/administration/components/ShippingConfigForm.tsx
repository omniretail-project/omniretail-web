"use client";

import { useState, type FormEvent } from "react";
import type { ShippingChannel } from "@/core/entities";
import type {
  ShippingChannelFormValue,
  ShippingConfigDto,
  ShippingConfigFormValue,
} from "@/modules/administration/application/dto/ShippingConfigDto";
import {
  getShippingConfigFieldErrors,
  SHIPPING_CHANNELS,
  toShippingConfigFormValue,
  type ShippingConfigFieldErrors,
} from "@/modules/administration/validation/shippingConfig.validation";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";

interface ShippingConfigFormProps {
  config: ShippingConfigDto;
  saving: boolean;
  onSave: (value: ShippingConfigFormValue) => Promise<void>;
}

const CHANNEL_PRESENTATION: Record<ShippingChannel, { title: string; description: string }> = {
  ecommerce: {
    title: "Tienda en línea",
    description: "Se suma al total de los pedidos con entrega a domicilio de la tienda.",
  },
  pos: {
    title: "POS · entrega a domicilio",
    description: "Se suma al cobro de las ventas del POS que se entregan a domicilio.",
  },
};

/** Resumen en lenguaje natural de lo que se cobrará con los valores actuales del formulario. */
function describeChannel(value: ShippingChannelFormValue): string {
  if (!value.enabled) return "No se cobra envío.";
  const fee = Number(value.deliveryFee);
  const threshold = value.freeShippingThreshold.trim();
  const feeText =
    Number.isFinite(fee) && value.deliveryFee.trim() ? `Q${fee.toFixed(2)}` : "la tarifa";
  if (!threshold) return `Se cobra ${feeText} en todos los pedidos.`;
  const thresholdNumber = Number(threshold);
  if (!Number.isFinite(thresholdNumber)) return `Se cobra ${feeText}.`;
  return `Se cobra ${feeText}; gratis desde Q${thresholdNumber.toFixed(2)}.`;
}

export function ShippingConfigForm({ config, saving, onSave }: ShippingConfigFormProps) {
  const [value, setValue] = useState<ShippingConfigFormValue>(() =>
    toShippingConfigFormValue(config),
  );
  const [fieldErrors, setFieldErrors] = useState<ShippingConfigFieldErrors>({});
  const initial = toShippingConfigFormValue(config);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  function updateChannel(channel: ShippingChannel, patch: Partial<ShippingChannelFormValue>) {
    setValue((current) => ({ ...current, [channel]: { ...current[channel], ...patch } }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = getShippingConfigFieldErrors(value);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    try {
      await onSave(value);
    } catch {
      // El error lo muestra el padre; se conserva lo escrito.
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="border-b border-[var(--color-border)] pb-3">
        <h2 className="text-lg font-bold text-[var(--color-title)]">Costo de envío</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Tarifa fija para entregas a domicilio de cada canal, con un monto opcional desde el cual
          el envío es gratis. Se calcula sobre el subtotal con descuentos.
        </p>
      </div>

      <form className="mt-4 space-y-4" noValidate onSubmit={handleSubmit}>
        <div className="grid gap-4 lg:grid-cols-2">
          {SHIPPING_CHANNELS.map((channel) => {
            const channelValue = value[channel];
            const presentation = CHANNEL_PRESENTATION[channel];
            const feeId = `shipping-${channel}-fee`;
            const thresholdId = `shipping-${channel}-threshold`;
            return (
              <fieldset
                className="space-y-3 rounded-lg border border-[var(--color-border)] p-4"
                disabled={saving}
                key={channel}
              >
                <legend className="px-1 text-sm font-semibold text-[var(--color-title)]">
                  {presentation.title}
                </legend>
                <p className="text-xs text-[var(--color-text-muted)]">{presentation.description}</p>
                <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                  <input
                    checked={channelValue.enabled}
                    onChange={(event) => updateChannel(channel, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  Cobrar envío a domicilio
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField
                    error={fieldErrors[`${channel}.deliveryFee`]}
                    id={feeId}
                    label="Tarifa (Q)"
                  >
                    <Input
                      disabled={!channelValue.enabled}
                      id={feeId}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateChannel(channel, { deliveryFee: event.target.value })
                      }
                      value={channelValue.deliveryFee}
                    />
                  </FormField>
                  <FormField
                    error={fieldErrors[`${channel}.freeShippingThreshold`]}
                    hint="Déjalo vacío si el envío nunca es gratis."
                    id={thresholdId}
                    label="Envío gratis desde (Q)"
                  >
                    <Input
                      disabled={!channelValue.enabled}
                      id={thresholdId}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateChannel(channel, { freeShippingThreshold: event.target.value })
                      }
                      value={channelValue.freeShippingThreshold}
                    />
                  </FormField>
                </div>
                <p aria-live="polite" className="text-sm text-[var(--color-text)]">
                  {describeChannel(channelValue)}
                </p>
              </fieldset>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-4">
          <Button disabled={saving || !dirty} type="submit">
            {saving ? "Guardando..." : "Guardar costo de envío"}
          </Button>
          {dirty && !saving ? (
            <Button
              onClick={() => {
                setValue(initial);
                setFieldErrors({});
              }}
              type="button"
              variant="ghost"
            >
              Descartar cambios
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
