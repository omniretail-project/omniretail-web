"use client";

import type { BusinessCapabilitiesConfig } from "@/core/entities";
import { ProductType } from "@/core/enums";
import type { CreateProductDto } from "@/modules/catalog/application/dto/CreateProductDto";
import { applyTrackingRules } from "@/modules/catalog/validation/product.validation";

interface ProductTrackingSectionProps {
  value: CreateProductDto;
  capabilities: BusinessCapabilitiesConfig;
  onChange: (value: Partial<CreateProductDto>) => void;
}

export function ProductTrackingSection({
  value,
  capabilities,
  onChange,
}: ProductTrackingSectionProps) {
  const isService = value.productType === ProductType.service;
  const options = [
    { key: "stock", label: "Control de stock", enabled: capabilities.supportsInventory },
    { key: "lot", label: "Lotes", enabled: capabilities.supportsLots },
    { key: "expiration", label: "Fecha de vencimiento", enabled: capabilities.supportsExpiration },
    { key: "serial", label: "Numeros de serie", enabled: capabilities.supportsSerials },
  ] as const;

  function toggle(key: keyof CreateProductDto["tracking"], checked: boolean) {
    const tracking = applyTrackingRules(
      value.productType,
      { ...value.tracking, [key]: checked },
      capabilities,
    );
    onChange({ tracking });
  }

  return (
    <section className="space-y-4 rounded-md border border-[var(--color-border)] bg-white p-5">
      <h2 className="text-lg font-semibold text-[var(--color-title)]">Control y trazabilidad</h2>
      {isService ? (
        <p className="rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm text-[var(--color-text)]">
          Los servicios no utilizan control de inventario.
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {options.map((option) => {
          const disabled = isService || !option.enabled;
          if (!option.enabled && !value.tracking[option.key]) return null;
          return (
            <label
              className="flex items-start gap-3 rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text)]"
              key={option.key}
            >
              <input
                checked={value.tracking[option.key]}
                className="mt-1 h-4 w-4 accent-[var(--color-structure)]"
                disabled={disabled}
                onChange={(event) => toggle(option.key, event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="block font-semibold">{option.label}</span>
                {!option.enabled ? (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    No disponible para este negocio.
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
