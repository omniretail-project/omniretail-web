"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerOrderDetailDto } from "@/modules/customer/application/dto/CustomerOrderDetailDto";
import { getCurrentCustomerOrderDetail } from "@/modules/customer/application/services/orderService";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

export function useCustomerOrderDetail(orderId: string) {
  const repositories = useRepositories();
  const [order, setOrder] = useState<CustomerOrderDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const nextOrder = await getCurrentCustomerOrderDetail(repositories, orderId);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setOrder(nextOrder);
      setError(null);
    } catch (cause) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setOrder(null);
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el pedido.");
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [orderId, repositories]);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++requestIdRef.current;
    const loadInitialOrder = async () => {
      try {
        const nextOrder = await getCurrentCustomerOrderDetail(repositories, orderId);
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setOrder(nextOrder);
        setError(null);
      } catch (cause) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setOrder(null);
        setError(cause instanceof Error ? cause.message : "No se pudo cargar el pedido.");
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
      }
    };

    void loadInitialOrder();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [orderId, repositories]);
  return { order, loading, error, reload };
}
