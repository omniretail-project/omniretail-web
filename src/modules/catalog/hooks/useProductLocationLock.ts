"use client";

import { useEffect, useState } from "react";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

export type ProductLocationLock =
  | { status: "unlocked" }
  | { status: "loading" }
  | { status: "locked"; reason: "stock" | "traceability" | "unverified" | "permission" };

/**
 * Ubicacion operativa del producto EN LA SUCURSAL ACTIVA, tal como la devolvio la lectura de su
 * configuracion de inventario. `locationId: null` significa que esa sucursal aun no tiene una
 * (asignacion inicial); un valor distinto de null es un cambio de una ubicacion existente.
 */
export type ProductLocationAssignment =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; locationId: string | null };

/**
 * Deriva la asignacion de la sucursal activa a partir de la configuracion de inventario ya cargada
 * (`baseline`, con "" = sin ubicacion) y del estado de su lectura. Sin configuracion cargada no se
 * adivina: mientras carga espera y, si la lectura fallo, queda en error (el selector se bloquea).
 */
export function resolveLocationAssignment(
  baseline: { defaultLocationId?: string } | undefined,
  loadStatus: "notLoaded" | "loading" | "loaded" | "error",
): ProductLocationAssignment {
  if (baseline !== undefined) {
    return { status: "ready", locationId: baseline.defaultLocationId || null };
  }
  return loadStatus === "error" ? { status: "error" } : { status: "loading" };
}

interface UseProductLocationLockInput {
  /** Solo un producto fisico existente que controla stock puede quedar bloqueado. */
  enabled: boolean;
  tenantId?: string;
  productId?: string;
  branchId?: string;
  /** Trazabilidad PERSISTIDA del producto. */
  tracking?: ProductTrackingConfig;
  canReadStock: boolean;
  /** Estado de la configuracion de inventario de ESTA sucursal (ver ProductLocationAssignment). */
  assignment: ProductLocationAssignment;
}

/**
 * Decide si la ubicacion operativa de un producto existente puede elegirse o cambiarse en la
 * sucursal activa. Distingue dos operaciones:
 *  - ASIGNACION INICIAL (la sucursal no tiene ubicacion): se habilita si los balances fisicos de ESA
 *    sucursal, leidos en fresco, no muestran existencias ni reservas. Tener lote, serie o
 *    vencimiento activados a nivel de catalogo NO la bloquea: el stock de otras sucursales no
 *    cuenta.
 *  - CAMBIO de una ubicacion existente: conservador. Un producto con lote, serie o vencimiento
 *    queda bloqueado (el contrato disponible no expone lotes, series ni movimientos pendientes) y
 *    los demas se bloquean si hay existencias o reservas en la sucursal.
 * Bloquea tambien mientras carga, si la lectura falla o no hay permiso para verificar. Habilitar el
 * selector NO autoriza nada: el backend sigue siendo la autoridad al guardar (HTTP 409).
 */
export function useProductLocationLock({
  enabled,
  tenantId,
  productId,
  branchId,
  tracking,
  canReadStock,
  assignment,
}: UseProductLocationLockInput): ProductLocationLock {
  const repositories = useRepositories();
  const key = `${tenantId}|${productId}|${branchId}`;
  const traceable = Boolean(tracking && (tracking.lot || tracking.serial || tracking.expiration));
  const contextReady = Boolean(tenantId && productId && branchId);
  const initialAssignment = assignment.status === "ready" && assignment.locationId === null;
  const traceabilityBlocks = traceable && !initialAssignment;
  const readsBalances =
    enabled && contextReady && canReadStock && assignment.status === "ready" && !traceabilityBlocks;
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
  if (!contextReady) return { status: "locked", reason: "unverified" };
  if (!canReadStock) return { status: "locked", reason: "permission" };
  if (assignment.status === "error") return { status: "locked", reason: "unverified" };
  if (assignment.status === "loading") return { status: "loading" };
  if (traceabilityBlocks) return { status: "locked", reason: "traceability" };
  return result?.key === key ? result.lock : { status: "loading" };
}
