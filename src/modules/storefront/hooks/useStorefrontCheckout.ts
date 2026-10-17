"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { isApiMode } from "@/config/api-mode";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { StorefrontCheckoutFormDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import { CreateStorefrontCheckoutService } from "@/modules/storefront/application/services/CreateStorefrontCheckoutService";
import { ApiStorefrontCheckoutService } from "@/modules/storefront/application/services/ApiStorefrontCheckoutService";
import { useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";
import { useStorefrontCheckoutConfirmation } from "@/modules/storefront/providers/StorefrontCheckoutConfirmationProvider";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

const INSUFFICIENT_STOCK_MESSAGE =
  "Uno o más productos en tu carrito no cuentan con existencias suficientes. Por favor revisa las cantidades.";

function isInsufficientStockError(cause: unknown): boolean {
  if (cause instanceof BackendRequestError) {
    return cause.status === 409 && cause.code === "INSUFFICIENT_STOCK";
  }
  // Modo mock: el reservador local lanza errores planos con estos textos.
  const message = cause instanceof Error ? cause.message : "";
  return message.includes("Inventory reservation conflict") || message.includes("Insufficient stock");
}

export function useStorefrontCheckout() {
  const repositories = useRepositories();
  const { tenantId, tenantSlug } = usePublicTenant();
  const { items, clearCart } = useStorefrontCart();
  const { result, setResult } = useStorefrontCheckoutConfirmation();
  const service = useMemo(() => new CreateStorefrontCheckoutService(repositories), [repositories]);
  const apiService = useMemo(() => new ApiStorefrontCheckoutService(), []);
  const keyRef = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (form: StorefrontCheckoutFormDto) => {
      if (!tenantId) {
        setError("La tienda pública no está disponible.");
        return;
      }
      setSubmitting(true);
      setError(null);
      keyRef.current ??= globalThis.crypto.randomUUID();

      try {
        const checkoutInput = {
          tenantSlug,
          items,
          form,
          idempotencyKey: keyRef.current,
        };
        const nextResult = await (isApiMode()
          ? apiService.execute(checkoutInput)
          : service.execute(checkoutInput));
        setResult(nextResult);
        clearCart();
      } catch (cause) {
        keyRef.current = null;
        const message = cause instanceof Error ? cause.message : "";
        setError(
          isInsufficientStockError(cause)
            ? INSUFFICIENT_STOCK_MESSAGE
            : message || "No se pudo procesar el pedido.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [apiService, clearCart, items, service, setResult, tenantId, tenantSlug],
  );

  return { submitting, error, result, submit };
}
