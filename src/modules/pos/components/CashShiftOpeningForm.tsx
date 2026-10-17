"use client";

import { useState } from "react";
import type { OpenCashShiftFormInput } from "@/modules/pos/hooks/usePosCashShift";
import {
  hasCashShiftFormErrors,
  validateOpenCashShift,
  type CashShiftFormErrors,
} from "@/modules/pos/validation/cashShift.validation";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";

interface CashShiftOpeningFormProps {
  branchName: string | null;
  canOpen: boolean;
  loading: boolean;
  onOpen: (input: OpenCashShiftFormInput) => Promise<boolean>;
}

export function CashShiftOpeningForm({
  branchName,
  canOpen,
  loading,
  onOpen,
}: CashShiftOpeningFormProps) {
  const [registerCode, setRegisterCode] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");
  const [errors, setErrors] = useState<CashShiftFormErrors>({});

  function updateRegisterCode(nextRegisterCode: string): void {
    setRegisterCode(nextRegisterCode);
    setErrors((current) => {
      if (!current.registerCode) return current;

      const numericAmount = openingAmount.trim() === "" ? Number.NaN : Number(openingAmount);
      return {
        ...current,
        registerCode: validateOpenCashShift(nextRegisterCode, numericAmount).registerCode,
      };
    });
  }

  function updateOpeningAmount(nextOpeningAmount: string): void {
    setOpeningAmount(nextOpeningAmount);
    setErrors((current) => {
      if (!current.amount) return current;

      const numericAmount = nextOpeningAmount.trim() === "" ? Number.NaN : Number(nextOpeningAmount);
      return {
        ...current,
        amount: validateOpenCashShift(registerCode, numericAmount).amount,
      };
    });
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-3">
        <h2 className="text-lg font-bold text-[var(--color-title)]">Abrir caja</h2>
        <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
          Registra el fondo inicial para comenzar a operar en {branchName ?? "la sucursal activa"}.
        </p>
      </div>

      <form
        className="mt-4 grid max-w-3xl gap-3 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const amount = openingAmount.trim() ? Number(openingAmount) : Number.NaN;
          const nextErrors = validateOpenCashShift(registerCode, amount);
          setErrors(nextErrors);
          if (hasCashShiftFormErrors(nextErrors)) return;
          await onOpen({ registerCode: registerCode.trim(), openingAmount: amount });
        }}
      >
        <FormField id="cash-register-code" label="Código de caja" error={errors.registerCode}>
          <Input
            autoComplete="off"
            id="cash-register-code"
            maxLength={40}
            placeholder="Ej. CAJA-01"
            value={registerCode}
            onChange={(event) => updateRegisterCode(event.target.value)}
          />
        </FormField>
        <FormField
          id="cash-opening-amount"
          label="Fondo inicial"
          error={errors.amount}
          hint="La caja puede abrirse con Q 0.00 si no tendrá fondo inicial."
        >
          <Input
            id="cash-opening-amount"
            inputMode="decimal"
            min="0"
            placeholder="0.00"
            step="0.01"
            type="number"
            value={openingAmount}
            onChange={(event) => updateOpeningAmount(event.target.value)}
          />
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3 md:col-span-2">
          <p className="text-xs text-[var(--color-text-muted)]">
            Código de caja y fondo inicial del nuevo turno.
          </p>
          <Button className="w-full sm:w-auto" disabled={!canOpen || loading} type="submit">
            {loading ? "Abriendo..." : "Abrir caja"}
          </Button>
        </div>
        {!canOpen ? (
          <p className="text-sm text-[var(--color-warning)] md:col-span-2">
            No dispone de permisos para abrir caja.
          </p>
        ) : null}
      </form>
    </section>
  );
}
