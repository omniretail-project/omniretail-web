import type { FormEvent } from "react";
import { BusinessPreset, PaymentMethod } from "@/core/enums";
import type { BusinessConfigDto } from "@/modules/administration/application/dto/BusinessConfigDto";
import { BusinessConfigSection } from "@/modules/administration/components/BusinessConfigSection";
import { BusinessConfigToggle } from "@/modules/administration/components/BusinessConfigToggle";
import { Button } from "@/shared/components/Button";
import { SaveIcon } from "@/shared/components/icons";
import { Select } from "@/shared/components/Select";

export type BusinessCapabilityKey =
  | "supportsInventory"
  | "supportsLots"
  | "supportsExpiration"
  | "supportsSerials"
  | "supportsMultipleLocations"
  | "supportsUnitsAndPackaging"
  | "supportsProductAttributes"
  | "supportsKits"
  | "supportsServices";

export type BusinessTrackingKey = keyof BusinessConfigDto["defaultProductTracking"];

const posPaymentOptions: Array<{
  description: string;
  key: PaymentMethod;
  label: string;
}> = [
  {
    key: PaymentMethod.cash,
    label: "Efectivo",
    description: "Acepta pagos en efectivo directamente en caja.",
  },
  {
    key: PaymentMethod.card,
    label: "Pago con tarjeta",
    description: "Acepta pagos con tarjeta de débito o crédito.",
  },
  {
    key: PaymentMethod.transfer,
    label: "Transferencia bancaria",
    description: "Acepta pagos mediante transferencia o depósito bancario.",
  },
];

interface BusinessConfigFormProps {
  busy: boolean;
  onCapabilityChange: (capability: BusinessCapabilityKey, checked: boolean) => void;
  onPresetChange: (preset: BusinessPreset) => void;
  onPosPaymentChange: (method: PaymentMethod, checked: boolean) => void;
  onSubmit: () => Promise<void>;
  onTrackingChange: (tracking: BusinessTrackingKey, checked: boolean) => void;
  value: BusinessConfigDto;
}

const capabilityOptions: Array<{
  description: string;
  key: BusinessCapabilityKey;
  label: string;
  requiresInventory?: boolean;
}> = [
  {
    key: "supportsInventory",
    label: "Control de inventario",
    description: "Habilita existencias, movimientos y disponibilidad de productos.",
  },
  {
    key: "supportsLots",
    label: "Manejo de lotes",
    description: "Permite identificar existencias por lote de producción o compra.",
    requiresInventory: true,
  },
  {
    key: "supportsExpiration",
    label: "Control de vencimiento",
    description: "Registra fechas de vencimiento para productos que lo necesiten.",
    requiresInventory: true,
  },
  {
    key: "supportsSerials",
    label: "Números de serie",
    description: "Identifica individualmente productos mediante un número de serie.",
    requiresInventory: true,
  },
  {
    key: "supportsMultipleLocations",
    label: "Múltiples ubicaciones",
    description: "Distribuye existencias entre sucursales, bodegas o ubicaciones internas.",
    requiresInventory: true,
  },
  {
    key: "supportsUnitsAndPackaging",
    label: "Unidades y empaques",
    description: "Permite vender o comprar productos en distintas presentaciones.",
  },
  {
    key: "supportsProductAttributes",
    label: "Atributos de producto",
    description: "Habilita características como marca, tamaño, color o material.",
  },
  {
    key: "supportsKits",
    label: "Kits y combinaciones",
    description: "Permite agrupar varios productos bajo una sola oferta comercial.",
  },
  {
    key: "supportsServices",
    label: "Productos de servicio",
    description: "Permite registrar servicios además de productos físicos.",
  },
];

const trackingOptions: Array<{
  capability?: BusinessCapabilityKey;
  description: string;
  key: BusinessTrackingKey;
  label: string;
}> = [
  {
    key: "stock",
    label: "Controlar existencias",
    description: "Los productos nuevos controlarán stock de forma predeterminada.",
  },
  {
    key: "lot",
    capability: "supportsLots",
    label: "Solicitar lote",
    description: "Los productos nuevos registrarán lote de forma predeterminada.",
  },
  {
    key: "expiration",
    capability: "supportsExpiration",
    label: "Solicitar vencimiento",
    description: "Los productos nuevos registrarán fecha de vencimiento de forma predeterminada.",
  },
  {
    key: "serial",
    capability: "supportsSerials",
    label: "Solicitar número de serie",
    description: "Los productos nuevos registrarán número de serie de forma predeterminada.",
  },
];

const presetOptions = [
  { label: "Ferretería", value: BusinessPreset.hardware_store },
  { label: "Farmacia", value: BusinessPreset.pharmacy },
  { label: "Abarrotería", value: BusinessPreset.grocery },
  { label: "Servicios", value: BusinessPreset.services },
  { label: "Personalizado", value: BusinessPreset.custom },
] as const;

export function BusinessConfigForm({
  busy,
  onCapabilityChange,
  onPresetChange,
  onPosPaymentChange,
  onSubmit,
  onTrackingChange,
  value,
}: BusinessConfigFormProps) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit();
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <BusinessConfigSection
        description="Seleccione una base según el giro del negocio. Después podrá ajustar cada capacidad."
        title="Preset de negocio"
      >
        <div className="max-w-xl space-y-2">
          <label
            className="text-sm font-semibold text-[var(--color-text)]"
            htmlFor="business-preset"
          >
            Tipo de operación
          </label>
          <Select
            disabled={busy}
            id="business-preset"
            onChange={(event) => onPresetChange(event.target.value as BusinessPreset)}
            value={value.preset}
          >
            {presetOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <p className="text-sm leading-5 text-[var(--color-text-muted)]">
            Cambiar el preset reemplaza la configuración actual por los valores recomendados.
          </p>
        </div>
      </BusinessConfigSection>

      <BusinessConfigSection
        description="Definí las funciones disponibles para este tenant. Estos cambios afectan Catálogo, Inventario, Compras, Recepciones, POS y Logística."
        title="Capacidades"
      >
        {!value.supportsInventory ? (
          <div className="mb-4 rounded-lg border border-[var(--color-warning)] bg-[var(--color-app-background)] px-4 py-3 text-sm leading-5 text-[var(--color-text)]">
            El control de inventario está desactivado. Las funciones de lotes, vencimiento, series,
            múltiples ubicaciones y toda la trazabilidad permanecerán apagadas.
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:border-slate-200 [&>*]:bg-slate-50/70 [&>*]:shadow-none">
          {capabilityOptions.map((option) => {
            const disabledByInventory = option.requiresInventory && !value.supportsInventory;

            return (
              <BusinessConfigToggle
                checked={value[option.key]}
                description={option.description}
                disabled={busy || disabledByInventory}
                disabledHint={
                  disabledByInventory ? "Requiere activar el control de inventario." : undefined
                }
                id={`business-capability-${option.key}`}
                key={option.key}
                label={option.label}
                onChange={(checked) => onCapabilityChange(option.key, checked)}
              />
            );
          })}
        </div>
      </BusinessConfigSection>

      <BusinessConfigSection
        description="Seleccione los métodos de pago que estarán disponibles en el punto de venta."
        title="Métodos de pago POS"
      >
        <div className="grid gap-3 md:grid-cols-2 [&>*]:border-slate-200 [&>*]:bg-slate-50/70 [&>*]:shadow-none">
          {posPaymentOptions.map((option) => {
            const checked = (value.allowedPosPaymentMethods ?? []).includes(option.key);

            return (
              <BusinessConfigToggle
                checked={checked}
                description={option.description}
                disabled={busy}
                id={`business-pos-payment-${option.key}`}
                key={option.key}
                label={option.label}
                onChange={(nextChecked) => onPosPaymentChange(option.key, nextChecked)}
              />
            );
          })}
        </div>
      </BusinessConfigSection>

      <BusinessConfigSection
        description="Seleccione los datos de trazabilidad que se activarán inicialmente al crear productos. Cada producto podrá conservar su propia configuración."
        title="Trazabilidad por defecto"
      >
        <div className="grid gap-3 md:grid-cols-2 [&>*]:border-slate-200 [&>*]:bg-slate-50/70 [&>*]:shadow-none">
          {trackingOptions.map((option) => {
            const disabledByInventory = !value.supportsInventory;
            const disabledByCapability = option.capability ? !value[option.capability] : false;
            const disabled = busy || disabledByInventory || disabledByCapability;

            return (
              <BusinessConfigToggle
                checked={value.defaultProductTracking[option.key]}
                description={option.description}
                disabled={disabled}
                disabledHint={
                  disabledByInventory
                    ? "Requiere activar el control de inventario."
                    : disabledByCapability
                      ? "Requiere activar la capacidad relacionada."
                      : undefined
                }
                id={`business-tracking-${option.key}`}
                key={option.key}
                label={option.label}
                onChange={(checked) => onTrackingChange(option.key, checked)}
              />
            );
          })}
        </div>
      </BusinessConfigSection>

      <footer className="sticky bottom-3 z-20 flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-white/95 p-3 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-5 text-[var(--color-text-muted)]">
          Los cambios se aplicarán a todo el negocio después de guardar.
        </p>
        <Button className="w-full gap-2 shrink-0 sm:w-auto" disabled={busy} type="submit">
          <SaveIcon className="h-4 w-4" />
          {busy ? "Guardando..." : "Guardar configuración"}
        </Button>
      </footer>
    </form>
  );
}
