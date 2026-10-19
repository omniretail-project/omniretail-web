"use client";

import Link from "next/link";
import type { StorageLocation } from "@/core/entities";
import { LocationStatus, ProductType } from "@/core/enums";
import { FormField } from "@/shared/components/FormField";
import { Select } from "@/shared/components/Select";
import type { ProductLocationLock } from "@/modules/catalog/hooks/useProductLocationLock";

export const LOCATION_REQUIRED_MESSAGE = "Selecciona una ubicación operativa para este producto";
export const LOCATION_LOCKED_MESSAGE =
  "Esta ubicación no se puede cambiar mientras el producto tenga existencias o movimientos operativos pendientes";

/**
 * Politica del formulario (no del backend): un producto fisico NUEVO que controla stock exige una
 * ubicacion operativa activa de la sucursal. Servicios, kits y productos sin control de stock no.
 */
export function validateOperationalLocation(input: {
  isEdit: boolean;
  productType: ProductType;
  tracksStock: boolean;
  selectedLocationId: string;
  activeLocationIds: readonly string[];
}): string | null {
  if (input.isEdit || input.productType !== ProductType.physical || !input.tracksStock) return null;
  return input.selectedLocationId && input.activeLocationIds.includes(input.selectedLocationId)
    ? null
    : LOCATION_REQUIRED_MESSAGE;
}

interface OperationalLocationFieldProps {
  isEdit: boolean;
  /** Ubicacion seleccionada ("" = ninguna). */
  value: string;
  /** Ubicacion cargada del backend; vacia = producto heredado sin asignacion. */
  baselineLocationId: string | null;
  /** Ubicaciones ACTIVAS de la sucursal actual. */
  locations: StorageLocation[];
  /** La asignada hoy, aunque ya no este activa (solo para explicarlo). */
  currentLocation: StorageLocation | null;
  locationsLoaded: boolean;
  /** Sin permiso, solo lectura o aun cargando ubicaciones. */
  disabled: boolean;
  lock: ProductLocationLock;
  error?: string;
  /** Error general del editor; solo se muestra aqui si habla de la ubicacion. */
  editorError: string | null;
  onChange: (locationId: string) => void;
}

/**
 * Selector de la ubicacion operativa de un producto fisico que controla stock. Nunca elige una
 * ubicacion por defecto; en altas es obligatorio y en edicion se bloquea (con explicacion) cuando el
 * producto tiene inventario que impide el cambio.
 */
export function OperationalLocationField({
  isEdit,
  value,
  baselineLocationId,
  locations,
  currentLocation,
  locationsLoaded,
  disabled,
  lock,
  error,
  editorError,
  onChange,
}: OperationalLocationFieldProps) {
  const locked = isEdit && lock.status !== "unlocked";
  const unavailableAssigned =
    currentLocation !== null &&
    currentLocation.id === value &&
    !locations.some((location) => location.id === currentLocation.id);
  const unavailableStatus =
    currentLocation?.status === LocationStatus.inactive ? "inactiva" : "archivada";

  return (
    <FormField id="default-location-id" label="Ubicación operativa" error={error}>
      <Select
        disabled={disabled || locked}
        id="default-location-id"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {!isEdit ? (
          <option disabled value="">
            Selecciona una ubicación operativa
          </option>
        ) : !baselineLocationId ? (
          <option value="">Sin ubicación asignada (producto heredado)</option>
        ) : null}
        {unavailableAssigned && currentLocation ? (
          <option disabled value={currentLocation.id}>
            {currentLocation.name} ({unavailableStatus})
          </option>
        ) : null}
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </Select>
      {editorError?.includes("ubicacion") ? (
        <p className="mt-2 text-sm font-semibold text-[var(--color-danger)]">{editorError}</p>
      ) : unavailableAssigned ? (
        <p className="mt-2 text-xs font-semibold text-[var(--color-danger)]">
          La ubicacion asignada actualmente esta {unavailableStatus}. Elige una activa.
        </p>
      ) : (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Solo se muestran ubicaciones activas de la sucursal actual. La ubicación operativa es
          independiente por sucursal.
        </p>
      )}
      {locked ? (
        <p className="mt-2 text-xs font-semibold text-[var(--color-text)]" role="note">
          {lock.status === "loading" ? (
            "Verificando las existencias del producto en esta sucursal..."
          ) : (
            <>
              {LOCATION_LOCKED_MESSAGE}.
              {lock.status === "locked" && lock.reason === "unverified"
                ? " No se pudo verificar el inventario, por seguridad se mantiene bloqueada."
                : null}
              {lock.status === "locked" && lock.reason === "traceability"
                ? " Los productos con lote, serie o vencimiento no pueden verificarse desde aquí."
                : null}
              {lock.status === "locked" && lock.reason === "stock" && !baselineLocationId ? (
                <>
                  {" "}
                  <Link
                    className="font-bold text-[var(--color-structure)] underline"
                    href="/inventario/regularizacion"
                  >
                    Ir a la regularización de ubicaciones
                  </Link>
                </>
              ) : null}
            </>
          )}
        </p>
      ) : null}
      {locationsLoaded && locations.length === 0 ? (
        <p className="mt-2 text-xs font-semibold text-[var(--color-danger)]" role="alert">
          La sucursal actual no tiene ubicaciones activas. Crea o activa una para poder asignarla al
          producto.{" "}
          <Link
            className="font-bold text-[var(--color-structure)] underline"
            href="/catalogo/ubicaciones"
          >
            Ir a ubicaciones
          </Link>
        </p>
      ) : null}
      {isEdit && !value ? (
        <p className="mt-2 text-xs font-semibold text-[var(--color-warning)]" role="note">
          Sin ubicación operativa, el producto no podrá recibir, reservar ni vender existencias en
          esta sucursal.
        </p>
      ) : null}
    </FormField>
  );
}
