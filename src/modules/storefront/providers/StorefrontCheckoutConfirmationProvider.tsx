"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { StorefrontCheckoutResultDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";

interface StorefrontCheckoutConfirmationContextValue {
  result: StorefrontCheckoutResultDto | null;
  setResult: (result: StorefrontCheckoutResultDto | null) => void;
}

const StorefrontCheckoutConfirmationContext =
  createContext<StorefrontCheckoutConfirmationContextValue | null>(null);

export function StorefrontCheckoutConfirmationProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<StorefrontCheckoutResultDto | null>(null);
  const value = useMemo(() => ({ result, setResult }), [result]);

  return (
    <StorefrontCheckoutConfirmationContext.Provider value={value}>
      {children}
    </StorefrontCheckoutConfirmationContext.Provider>
  );
}

export function useStorefrontCheckoutConfirmation() {
  const context = useContext(StorefrontCheckoutConfirmationContext);
  if (!context) {
    throw new Error(
      "useStorefrontCheckoutConfirmation must be used inside StorefrontCheckoutConfirmationProvider",
    );
  }

  return context;
}
