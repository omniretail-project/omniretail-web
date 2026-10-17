import { useState } from "react";
import type { EcommerceConfigInputDto } from "@/modules/administration/application/dto/EcommerceConfigDto";
import { BusinessConfigToggle } from "@/modules/administration/components/BusinessConfigToggle";
import { ImageUrlField } from "@/modules/administration/components/ImageUrlField";
import type { EcommerceBranchOption } from "@/modules/administration/hooks/useEcommerceConfig";
import {
  ADMIN_FIELD_LIMITS,
  formatGuatemalaPhoneInput,
} from "@/modules/administration/validation/adminFieldConstraints";
import { useBlobPreviewUrl, useCatalogImageUrl } from "@/infrastructure/media/useCatalogImageUrl";
import { processImageUpload } from "@/shared/application/services/processImageUpload";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";

interface EcommerceConfigFormProps {
  value: EcommerceConfigInputDto;
  fieldErrors?: Partial<Record<keyof EcommerceConfigInputDto, string>>;
  branchOptions: EcommerceBranchOption[];
  tenantId: string | null;
  saving: boolean;
  onChange: (value: EcommerceConfigInputDto) => void;
  /** Avisa si el campo de URL del logo tiene una URL invalida pendiente (bloquea el guardado). */
  onImageUrlInvalidChange?: (invalid: boolean) => void;
}

export function EcommerceConfigForm({
  value,
  fieldErrors,
  branchOptions,
  tenantId,
  saving,
  onChange,
  onImageUrlInvalidChange,
}: Readonly<EcommerceConfigFormProps>) {
  const activeBranchIds = new Set(branchOptions.map((option) => option.id));
  const preservedDefaultBranchId =
    value.defaultBranchId && !activeBranchIds.has(value.defaultBranchId)
      ? value.defaultBranchId
      : null;
  const [logoError, setLogoError] = useState<string | null>(null);
  const currentLogoUrl =
    value.logo?.kind === "url" && !value.removeLogo && !value.pendingLogo ? value.logo.src : "";
  // Cualquier cambio del logo por otra via (archivo, Eliminar, recarga) descarta el borrador de URL.
  const logoSyncKey = `${currentLogoUrl}|${value.pendingLogo ? "archivo" : ""}|${value.removeLogo ? "eliminado" : ""}`;
  const previewBlobUrl = useBlobPreviewUrl(value.pendingLogo?.blob);
  const persistedLogoUrl = useCatalogImageUrl(tenantId, value.removeLogo ? undefined : value.logo, "");
  const logoPreviewUrl = previewBlobUrl ?? persistedLogoUrl;
  const hasLogo = Boolean(value.pendingLogo || (value.logo && !value.removeLogo));

  function setField<Key extends keyof EcommerceConfigInputDto>(
    key: Key,
    fieldValue: EcommerceConfigInputDto[Key],
  ) {
    onChange({ ...value, [key]: fieldValue });
  }

  async function selectLogo(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    try {
      const pendingLogo = await processImageUpload(file);
      onChange({ ...value, pendingLogo, removeLogo: false });
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : "No se pudo procesar la imagen.");
    }
  }

  function removeLogo() {
    onChange({ ...value, logo: undefined, pendingLogo: undefined, removeLogo: true });
  }

  // El backend solo guarda URLs: el logo tambien se puede indicar con una URL publica.
  function changeLogoUrl(src: string) {
    onChange(
      src
        ? { ...value, logo: { kind: "url", src }, pendingLogo: undefined, removeLogo: false }
        : { ...value, logo: undefined, pendingLogo: undefined, removeLogo: Boolean(value.logo) },
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="border-b border-[var(--color-border)] pb-3">
          <h2 className="text-lg font-bold text-[var(--color-title)]">Configuración general</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Identidad y datos públicos de la tienda en línea.
          </p>
        </div>

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4">
            <FormField
              error={fieldErrors?.storeName}
              id="ecommerce-store-name"
              label="Nombre de la tienda"
            >
              <Input
                disabled={saving}
                id="ecommerce-store-name"
                maxLength={ADMIN_FIELD_LIMITS.ecommerceConfig.storeName}
                onChange={(event) => setField("storeName", event.target.value)}
                required
                value={value.storeName}
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                error={fieldErrors?.contactPhone}
                id="ecommerce-contact-phone"
                label="Teléfono público"
              >
                <Input
                  autoComplete="tel"
                  disabled={saving}
                  id="ecommerce-contact-phone"
                  maxLength={ADMIN_FIELD_LIMITS.ecommerceConfig.contactPhone}
                  onChange={(event) =>
                    setField("contactPhone", formatGuatemalaPhoneInput(event.target.value))
                  }
                  placeholder="0000-0000"
                  type="tel"
                  value={value.contactPhone ?? ""}
                />
              </FormField>
              <FormField
                error={fieldErrors?.contactEmail}
                id="ecommerce-contact-email"
                label="Correo público"
              >
                <Input
                  autoComplete="email"
                  disabled={saving}
                  id="ecommerce-contact-email"
                  maxLength={ADMIN_FIELD_LIMITS.ecommerceConfig.contactEmail}
                  onChange={(event) => setField("contactEmail", event.target.value)}
                  type="email"
                  value={value.contactEmail ?? ""}
                />
              </FormField>
            </div>
          </div>

          <FormField id="ecommerce-logo" label="Logo de la tienda">
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 lg:flex-col lg:items-stretch">
              {logoPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-lg bg-white object-contain p-1 shadow-sm lg:h-28 lg:w-full"
                  src={logoPreviewUrl}
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-white text-[10px] text-[var(--color-text-muted)] lg:h-28 lg:w-full">
                  Sin logo
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                <label className="inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-md bg-[var(--color-primary)] px-3 py-2 text-center text-sm font-semibold text-white">
                  {hasLogo ? "Reemplazar logo" : "Seleccionar logo"}
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      void selectLogo(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>
                {hasLogo ? (
                  <Button disabled={saving} onClick={removeLogo} type="button" variant="danger">
                    Eliminar
                  </Button>
                ) : null}
              </div>
            </div>
            {logoError ? (
              <p className="mt-2 text-sm text-[var(--color-danger)]">{logoError}</p>
            ) : null}
            <ImageUrlField
              currentUrl={currentLogoUrl}
              disabled={saving}
              id="ecommerce-logo-url"
              onChange={changeLogoUrl}
              onInvalidChange={onImageUrlInvalidChange}
              syncKey={logoSyncKey}
            />
          </FormField>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="border-b border-[var(--color-border)] pb-3">
          <h2 className="text-lg font-bold text-[var(--color-title)]">Operación de la tienda</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Disponibilidad, acceso de clientes y sucursal que atenderá los pedidos.
          </p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3 [&>*]:border-slate-200 [&>*]:bg-slate-50/70 [&>*]:shadow-none">
          <BusinessConfigToggle
            checked={value.enabled}
            description="Permite recibir pedidos desde el canal de e-commerce."
            disabled={saving}
            id="ecommerce-enabled"
            label="Tienda habilitada"
            onChange={(checked) => setField("enabled", checked)}
          />
          <BusinessConfigToggle
            checked={value.requireAccountForCheckout}
            description="Exige que el cliente tenga una cuenta antes de finalizar la compra."
            disabled={saving}
            id="ecommerce-require-account"
            label="Cuenta obligatoria"
            onChange={(checked) => setField("requireAccountForCheckout", checked)}
          />
          <BusinessConfigToggle
            checked={value.guestTrackingEnabled}
            description="Permite que invitados consulten el seguimiento de sus pedidos."
            disabled={saving}
            id="ecommerce-guest-tracking"
            label="Seguimiento para invitados"
            onChange={(checked) => setField("guestTrackingEnabled", checked)}
          />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <FormField
            error={fieldErrors?.defaultBranchId}
            hint={
              value.enabled
                ? "Obligatoria mientras la tienda está habilitada. Solo se muestran sucursales activas."
                : "Solo se muestran sucursales activas. Una selección guardada previamente se conserva."
            }
            id="ecommerce-default-branch"
            label="Sucursal predeterminada"
          >
            <Select
              disabled={saving}
              id="ecommerce-default-branch"
              onChange={(event) => setField("defaultBranchId", event.target.value || undefined)}
              required={value.enabled}
              value={value.defaultBranchId ?? ""}
            >
              <option value="">(Ninguna)</option>
              {preservedDefaultBranchId ? (
                <option value={preservedDefaultBranchId}>
                  Sucursal no activa ({preservedDefaultBranchId})
                </option>
              ) : null}
              {branchOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="rounded-lg bg-slate-50 px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--color-title)]">Pago y entrega</h3>
            <p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">
              El canal Web/App utiliza pago con tarjeta y envío a domicilio. Esta política es fija
              y no se configura desde esta pantalla.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
