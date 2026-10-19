"use client";

import { useEffect, useState } from "react";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

export type ProductLocationLock =
  | { status: "unlocked" }
  | { status: "loading" }
  | { status: "locked"; reason: "stock" | "traceability" | "unverified" };

interface UseProductLocationLockInput {
  /** Solo un producto fisico existente que controla stock puede quedar bloqueado. */
  enabled: boolean;
  tenantId?: string;
  productId?: string;
  branchId?: string;
  /** Trazabilidad PERSISTIDA del producto. */
  tracking?: ProductTrackingConfig;
  canReadStock: boolean;
}

/**
 * Decide si la ubicacion operativa de un producto existente puede cambiarse en la sucursal activa.
 * Lee los balances fisicos de ESA sucursal una sola vez (al abrir el editor); el stock de otras
 * sucursales no cuenta. Es conservador: bloquea mientras carga, si la consulta falla, si no hay
 * permiso para verificar y para productos con lote, serie o vencimiento (el contrato disponible no
 * expone lotes, series ni movimientos pendientes). El backend sigue siendo la autoridad (HTTP 409).
 */
export function useProductLocationLock({
  enabled,
  tenantId,
  productId,
  branchId,
  tracking,
  canReadStock,
}: UseProductLocationLockInput): ProductLocationLock {
  const repositories = useRepositories();
  const key = `${tenantId}|${productId}|${branchId}`;
  const traceable = Boolean(tracking && (tracking.lot || tracking.serial || tracking.expiration));
  const readsBalances =
    enabled && Boolean(tenantId && productId && branchId) && canReadStock && !traceable;
  const [result, setResult] = useState<{ key: string; lock: ProductLocationLock } | null>(null);

  useEffect(() => {
    if (!readsBalances || !tenantId || !productId || !branchId) return;
    let active = true;
    repositories.inventory
      .getProductBalances(productId, branchId, tenantId, { fresh: true })
      .then((balances) => {
        if (!active) return;
        // Existencia FISICA o reservas: "disponible para venta = 0" no libera la ubicacion.
        const held = balances.some(
          (balance) => balance.quantity > 0 || balance.reservedQuantity > 0,
        );
        setResult({
          key,
          lock: held ? { status: "locked", reason: "stock" } : { status: "unlocked" },
        });
      })
      .catch(() => {
        if (active) setResult({ key, lock: { status: "locked", reason: "unverified" } });
      });
    return () => {
      active = false;
    };
  }, [branchId, key, productId, readsBalances, repositories, tenantId]);

  if (!enabled) return { status: "unlocked" };
  if (!tenantId || !productId || !branchId || !canReadStock) {
    return { status: "locked", reason: "unverified" };
  }
  if (traceable) return { status: "locked", reason: "traceability" };
  return result?.key === key ? result.lock : { status: "loading" };
}
