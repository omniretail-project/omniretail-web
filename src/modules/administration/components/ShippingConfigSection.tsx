"use client";

import type { ShippingConfigFormValue } from "@/modules/administration/application/dto/ShippingConfigDto";
import { ShippingConfigForm } from "@/modules/administration/components/ShippingConfigForm";
import { useShippingConfig } from "@/modules/administration/hooks/useShippingConfig";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { useToast } from "@/shared/components/Toast";

/**
 * Sección "Costo de envío" de Configuración del negocio. No se renderiza sin
 * `admin.shipping_config.manage` (también validado en los services, no solo aquí).
 */
export function ShippingConfigSection() {
  const { canManage, config, error, loading, save, saving } = useShippingConfig();
  const { showToast } = useToast();

  if (!canManage) return null;

  async function handleSave(value: ShippingConfigFormValue) {
    try {
      await save(value);
      showToast({
        title: "Costo de envío guardado",
        description: "Los nuevos pedidos a domicilio usarán estas tarifas.",
        tone: "success",
      });
    } catch (caughtError) {
      showToast({
        title: "No se pudo guardar el costo de envío",
        description:
          caughtError instanceof Error
            ? caughtError.message
            : "Inténtelo nuevamente en unos momentos.",
        tone: "danger",
      });
      throw caughtError;
    }
  }

  if (loading && !config) {
    return (
      <div
        aria-live="polite"
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-muted)] shadow-sm"
      >
        Cargando costo de envío...
      </div>
    );
  }

  if (!config) {
    return error ? <InlineAlert title={error} tone="danger" /> : null;
  }

  return (
    <div className="space-y-3">
      {error ? <InlineAlert title={error} tone="danger" /> : null}
      <ShippingConfigForm
        config={config}
        key={JSON.stringify(config)}
        onSave={handleSave}
        saving={saving}
      />
    </div>
  );
}
