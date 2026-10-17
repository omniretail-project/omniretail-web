"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerPaymentMethod } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { PaymentMethodFormDto } from "@/modules/customer/application/dto/PaymentMethodFormDto";
import { CustomerIdentityError } from "@/modules/customer/application/services/CustomerAuthorizationContext";
import {
  createPaymentMethod,
  listPaymentMethods,
  removePaymentMethod,
  setDefaultPaymentMethod,
  updatePaymentMethod,
} from "@/modules/customer/application/services/paymentMethodService";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

/**
 * Solo pasa `repositories` (capacidad) + datos de negocio a los
 * application services -- nunca identidad del actor. El scope
 * (tenantId/customerId) se resuelve dentro de cada service, no aca.
 */
export function usePaymentMethods() {
  const repositories = useRepositories();
  const [paymentMethods, setPaymentMethods] = useState<CustomerPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listPaymentMethods(repositories);
      setPaymentMethods(items);
      setError(null);
    } catch (caughtError) {
      setPaymentMethods([]);
      setError(
        caughtError instanceof CustomerIdentityError
          ? caughtError.message
          : caughtError instanceof Error
            ? caughtError.message
            : "No se pudieron cargar los métodos de pago.",
      );
    } finally {
      setLoading(false);
    }
  }, [repositories]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      void reload();
    });
    return () => {
      active = false;
    };
  }, [reload]);

  useDataEvent("customer-payment-method.changed", reload);
  useDataEvent("auth.changed", reload);
  useDataEvent("user.changed", reload);

  const create = useCallback(
    async (dto: PaymentMethodFormDto) => {
      setBusy(true);
      try {
        return await createPaymentMethod(repositories, dto);
      } finally {
        setBusy(false);
      }
    },
    [repositories],
  );

  const update = useCallback(
    async (id: string, dto: PaymentMethodFormDto) => {
      setBusy(true);
      try {
        return await updatePaymentMethod(repositories, id, dto);
      } finally {
        setBusy(false);
      }
    },
    [repositories],
  );

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await removePaymentMethod(repositories, id);
      } finally {
        setBusy(false);
      }
    },
    [repositories],
  );

  const setDefault = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        return await setDefaultPaymentMethod(repositories, id);
      } finally {
        setBusy(false);
      }
    },
    [repositories],
  );

  return { paymentMethods, loading, busy, error, reload, create, update, remove, setDefault };
}
