"use client";

import { useCallback, useEffect, useState } from "react";
import type { Customer } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { CustomerIdentityError } from "@/modules/customer/application/services/CustomerAuthorizationContext";
import { getCurrentCustomerProfile } from "@/modules/customer/application/services/getCurrentCustomerProfile";
import { updateCustomerProfile } from "@/modules/customer/application/services/updateCustomerProfile";
import type { ProfileFormDto } from "@/modules/customer/application/dto/ProfileFormDto";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

/**
 * Ni la lectura ni la escritura reciben identidad desde este hook -- solo
 * pasan `repositories` (una capacidad, no un dato de identidad) a los
 * application services, que resuelven todo internamente via
 * resolveCustomerAuthorizationContext.
 */
export function useCustomerProfile() {
  const repositories = useRepositories();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCurrentCustomerProfile(repositories);
      setCustomer(result);
      setError(null);
    } catch (caughtError) {
      setCustomer(null);
      setError(
        caughtError instanceof CustomerIdentityError
          ? caughtError.message
          : "No se pudo cargar el perfil.",
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

  useDataEvent("customer.changed", reload);
  useDataEvent("user.changed", reload);
  useDataEvent("auth.changed", reload);

  const update = useCallback(
    async (dto: ProfileFormDto) => {
      setSaving(true);
      try {
        const updated = await updateCustomerProfile(repositories, dto);
        setCustomer(updated);
        return updated;
      } finally {
        setSaving(false);
      }
    },
    [repositories],
  );

  return {
    customer,
    email: customer?.email,
    loading,
    saving,
    error,
    update,
  };
}
