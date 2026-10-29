"use client";

import { useRef, useState } from "react";
import { CashMovementType } from "@/core/enums";
import type { CashMovementFormInput } from "@/modules/pos/hooks/usePosCashShift";
import {
  hasCashShiftFormErrors,
  validateCashMovement,
  type CashShiftFormErrors,
} from "@/modules/pos/validation/cashShift.validation";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { Select } from "@/shared/components/Select";

interface CashMovementModalProps {
  error?: string | null;
  loading: boolean;
  open: boolean;
  /**
   * Resultado incierto de un envio anterior: mientras exista NO se puede registrar de nuevo (el movimiento
   * pudo haberse guardado). El formulario conserva lo escrito y solo permite verificar o cancelar.
   */
  verification?: { message: string } | null;
  verifying?: boolean;
  onClose: () => void;
  onSubmit: (input: CashMovementFormInput) => Promise<boolean>;
  onVerify?: () => Promise<boolean>;
}

export function CashMovementModal({
  error,
  loading,
  open,
  verification = null,
  verifying = false,
  onClose,
  onSubmit,
  onVerify,
}: CashMovementModalProps) {
  const [type, setType] = useState<CashMovementType>(CashMovementType.in);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<CashShiftFormErrors>({});
  // Barrera sincrona contra doble clic / Enter repetido: `loading` llega con el siguiente render.
  const submittingRef = useRef(false);
  const blocked = loading || verifying || verification !== null;

  const resetForm = () => {
    setType(CashMovementType.in);
    setAmount("");
    setReason("");
    setErrors({});
  };

  const closeModal = () => {
    resetForm();
    onClose();
  };

  const updateAmount = (nextAmount: string) => {
    setAmount(nextAmount);
    setErrors((current) => {
      if (!current.amount) return current;
      const validation = validateCashMovement(
        type,
        nextAmount.trim() ? Number(nextAmount) : Number.NaN,
        reason,
      );
      return { ...current, amount: validation.amount };
    });
  };

  const updateReason = (nextReason: string) => {
    setReason(nextReason);
    setErrors((current) => {
      if (!current.reason) return current;
      const validation = validateCashMovement(
        type,
        amount.trim() ? Number(amount) : Number.NaN,
        nextReason,
      );
      return { ...current, reason: validation.reason };
    });
  };

  return (
    <Modal
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={loading || verifying} onClick={closeModal} type="button" variant="secondary">
            Cancelar
          </Button>
          {verification ? (
            <Button
              disabled={verifying}
              onClick={async () => {
                if (submittingRef.current || !onVerify) return;
                submittingRef.current = true;
                try {
                  if (await onVerify()) closeModal();
                } finally {
                  submittingRef.current = false;
                }
              }}
              type="button"
            >
              {verifying ? "Verificando..." : "Verificar de nuevo"}
            </Button>
          ) : (
            <Button disabled={loading} form="cash-movement-form" type="submit">
              {loading ? "Registrando..." : "Registrar movimiento"}
            </Button>
          )}
        </div>
      }
      onClose={closeModal}
      open={open}
      density="compact"
      subtitle="El movimiento afectará el efectivo esperado del turno actual."
      title="Nuevo movimiento de caja"
    >
      <form
        className="space-y-3"
        id="cash-movement-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (submittingRef.current || blocked) return;
          const numericAmount = Number(amount);
          const nextErrors = validateCashMovement(type, numericAmount, reason);
          setErrors(nextErrors);
          if (hasCashShiftFormErrors(nextErrors)) return;
          submittingRef.current = true;
          try {
            if (await onSubmit({ type, amount: numericAmount, reason: reason.trim() })) closeModal();
          } finally {
            submittingRef.current = false;
          }
        }}
      >
        {verification ? (
          <InlineAlert description={verification.message} title="Resultado no confirmado" tone="warning" />
        ) : error ? (
          <InlineAlert description={error} title="No se pudo registrar el movimiento" />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="cash-movement-type" label="Tipo de movimiento">
            <Select
              id="cash-movement-type"
              value={type}
              onChange={(event) =>
                setType(
                  event.target.value === CashMovementType.out
                    ? CashMovementType.out
                    : CashMovementType.in,
                )
              }
            >
              <option value={CashMovementType.in}>Ingreso de efectivo</option>
              <option value={CashMovementType.out}>Egreso de efectivo</option>
            </Select>
          </FormField>
          <FormField id="cash-movement-amount" label="Monto" error={errors.amount}>
            <Input
              id="cash-movement-amount"
              inputMode="decimal"
              min="0.01"
              placeholder="0.00"
              step="0.01"
              type="number"
              value={amount}
              onChange={(event) => updateAmount(event.target.value)}
            />
          </FormField>
        </div>
        <FormField id="cash-movement-reason" label="Motivo" error={errors.reason}>
          <Input
            autoComplete="off"
            id="cash-movement-reason"
            maxLength={160}
            placeholder="Describe el ingreso o egreso"
            value={reason}
            onChange={(event) => updateReason(event.target.value)}
          />
        </FormField>
      </form>
    </Modal>
  );
}
