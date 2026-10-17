"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { AddressFormDto } from "@/modules/customer/application/dto/AddressFormDto";
import {
  createAddress,
  listAddresses,
  removeAddress,
  setDefaultAddress,
  updateAddress,
} from "@/modules/customer/application/services/addressService";
import { CustomerIdentityError } from "@/modules/customer/application/services/CustomerAuthorizationContext";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

/**
 * Solo pasa `repositories` (capacidad) + datos de negocio (addressId,
 * dto) a los application services -- nunca identidad del actor. El
 * scope (tenantId/customerId) se resuelve dentro de cada service, no
 * aca.
 */
export function useAddresses() {
  const repositories = useRepositories();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listAddresses(repositories);
      setAddresses(items);
      setError(null);
    } catch (caughtError) {
      setAddresses([]);
      setError(
        caughtError instanceof CustomerIdentityError
          ? caughtError.message
          : caughtError instanceof Error
            ? caughtError.message
            : "No se pudieron cargar las direcciones.",
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

  useDataEvent("address.changed", reload);
  useDataEvent("auth.changed", reload);
  useDataEvent("user.changed", reload);

  const create = useCallback(
    async (dto: AddressFormDto) => {
      setBusy(true);
      try {
        return await createAddress(repositories, dto);
      } finally {
        setBusy(false);
      }
    },
    [repositories],
  );

  const update = useCallback(
    async (id: string, dto: AddressFormDto) => {
      setBusy(true);
      try {
        return await updateAddress(repositories, id, dto);
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
        await removeAddress(repositories, id);
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
        return await setDefaultAddress(repositories, id);
      } finally {
        setBusy(false);
      }
    },
    [repositories],
  );

  return { addresses, loading, busy, error, reload, create, update, remove, setDefault };
}
