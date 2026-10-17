"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { GetInventoryProductTransfersService, type InventoryProductTransfersReadModel } from "@/modules/inventory/application/services/GetInventoryProductTransfersService";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export function useInventoryProductTransfers(branchId: string, productId: string) {
  const repositories = useRepositories();
  const service = useMemo(() => new GetInventoryProductTransfersService(repositories), [repositories]);
  const [data, setData] = useState<InventoryProductTransfersReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);

  const reload = useCallback(async () => {
    const token = ++request.current;
    if (!branchId || !productId) return;
    try {
      const next = await service.execute(branchId, productId);
      if (token !== request.current) return;
      setData(next);
      setError(null);
    } catch {
      if (token !== request.current) return;
      setError("No se pudieron cargar las solicitudes y traslados.");
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [branchId, productId, service]);

  useEffect(() => {
    const token = ++request.current;
    if (branchId && productId) {
      void service.execute(branchId, productId)
        .then((next) => {
          if (token !== request.current) return;
          setData(next);
          setError(null);
        })
        .catch(() => {
          if (token === request.current) setError("No se pudieron cargar las solicitudes y traslados.");
        })
        .finally(() => {
          if (token === request.current) setLoading(false);
        });
    }
    return () => { request.current += 1; };
  }, [branchId, productId, service]);
  useDataEvent("inventory-transfer-request.changed", reload);
  useDataEvent("inventory-transfer.changed", reload);
  useDataEvent("picking.changed", reload);
  useDataEvent("packing.changed", reload);
  useDataEvent("dispatch.changed", reload);
  useDataEvent("receipt.changed", reload);

  return { data, error, loading, reload };
}
