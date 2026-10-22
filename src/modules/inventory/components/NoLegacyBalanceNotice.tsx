import Link from "next/link";
import { InlineAlert } from "@/shared/components/InlineAlert";

export interface NoLegacyBalanceNoticeProps {
  productId: string;
  productName: string;
  /** Etiqueta de la ubicacion operativa ya asignada; ausente cuando el producto no tiene ninguna. */
  assignedLocationLabel?: string;
  /** El usuario puede actualizar productos (permiso requerido para asignar la ubicacion inicial). */
  canEditProduct: boolean;
  /** Sucursal elegida en esta pantalla para regularizar. */
  branchName?: string;
  /**
   * El editor de producto trabaja con la sucursal ACTIVA del encabezado. Solo si coincide con la
   * sucursal elegida aqui el enlace lleva a la sucursal correcta; si no, se orienta a cambiarla.
   */
  editorMatchesBranch?: boolean;
}

/**
 * Resultado "no hay nada que regularizar" (INVENTORY_REGULARIZATION_NOT_REQUIRED): el producto no
 * tiene saldo heredado sin ubicacion. Distingue los dos casos reales y solo ofrece el enlace al
 * editor cuando la accion es posible para el usuario y apunta a la sucursal elegida. Nunca crea
 * movimientos ni ofrece confirmar.
 */
export function NoLegacyBalanceNotice({
  productId,
  productName,
  assignedLocationLabel,
  canEditProduct,
  branchName,
  editorMatchesBranch = true,
}: NoLegacyBalanceNoticeProps) {
  if (assignedLocationLabel) {
    return (
      <InlineAlert
        description="La ubicación asignada no se cambia desde aquí; para moverla usa un traslado."
        title={`${productName} ya tiene la ubicación ${assignedLocationLabel} y no tiene saldos sin ubicación pendientes.`}
        tone="info"
      />
    );
  }

  return (
    <InlineAlert
      description="No se registrará ningún movimiento: la ubicación inicial se asigna desde la ficha del producto, en Inventario y trazabilidad."
      title={`${productName} no tiene saldo heredado que regularizar ni ubicación operativa en esta sucursal.`}
      tone="info"
    >
      {!canEditProduct ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Solicita a un administrador con permiso para actualizar productos que asigne la ubicación.
        </p>
      ) : editorMatchesBranch ? (
        <Link
          className="inline-block text-sm font-bold text-[var(--color-structure)] underline"
          href={`/catalogo/productos/${productId}/editar`}
        >
          Asignar ubicación en la ficha del producto
        </Link>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          La ficha del producto trabaja con la sucursal activa del encabezado, que no es
          {branchName ? ` «${branchName}»` : " la elegida aquí"}. Cambia la sucursal activa y abre
          el producto desde Catálogo para asignar su ubicación en la sucursal correcta.
        </p>
      )}
    </InlineAlert>
  );
}
