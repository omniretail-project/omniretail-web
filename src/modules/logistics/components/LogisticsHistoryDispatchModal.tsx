"use client";

import { useState } from "react";
import { TransportMode } from "@/core/enums";
import type { PreparedOrderDetailDto } from "@/modules/logistics/application/dto/DispatchReadModelDto";
import {
  validateDispatchShipment,
  type DispatchShipmentFormValues,
  type DispatchShipmentValidationResult,
} from "@/modules/logistics/validation/dispatch.validation";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";

interface LogisticsHistoryDispatchModalProps {
  open: boolean;
  detail: PreparedOrderDetailDto | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (validation: DispatchShipmentValidationResult) => Promise<boolean>;
}

const emptyValues: DispatchShipmentFormValues = {
  carrierName: "",
  trackingNumber: "",
};

export function LogisticsHistoryDispatchModal({
  open,
  detail,
  loading,
  submitting,
  error,
  onClose,
  onConfirm,
}: LogisticsHistoryDispatchModalProps) {
  const [values, setValues] = useState(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const thirdParty = detail?.transportMode === TransportMode.third_party;
  const sendsNotificationEmail = detail?.notificationContact.emailMode === "send";

  const confirm = async () => {
    if (!detail || submitting) return;
    const validation = validateDispatchShipment(detail.transportMode, values);
    setErrors(validation.errors);
    if (!validation.valid) return;
    await onConfirm(validation);
  };

  return (
    <Modal
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={submitting} type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!detail || loading || submitting} type="button" onClick={() => void confirm()}>
            {submitting
              ? "Confirmando..."
              : sendsNotificationEmail
                ? "Confirmar despacho y enviar correo"
                : "Confirmar despacho"}
          </Button>
        </div>
      }
      onClose={submitting ? () => undefined : onClose}
      open={open}
      size="lg"
      subtitle={detail?.orderReference ?? "Preparando datos de despacho"}
      title="Agregar guía y confirmar despacho"
    >
      {loading ? (
        <p className="rounded-lg border border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]">
          Cargando pedido preparado...
        </p>
      ) : null}
      {error ? <InlineAlert description={error} title="No se pudo completar el despacho" /> : null}
      {detail ? (
        <div className="space-y-4">
          <section className="rounded-lg border border-[var(--color-border)] bg-slate-50 p-3.5">
            <h3 className="text-sm font-bold text-[var(--color-title)]">Pedido {detail.orderReference}</h3>
            <dl className="mt-2 grid gap-2.5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Destinatario</dt>
                <dd className="mt-1 font-medium">{detail.recipientName || "No disponible"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Modalidad de transporte</dt>
                <dd className="mt-1 font-medium">
                  {thirdParty ? "Transporte externo" : "Flota propia"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-t-4 border-[var(--color-border)] border-t-[var(--color-structure)] bg-white p-3.5">
            <h3 className="text-sm font-bold text-[var(--color-title)]">Datos de salida</h3>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              {thirdParty
                ? "El transporte y el número de guía son obligatorios."
                : "Para flota propia, el transporte y la guía son opcionales."}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <FormField
                error={errors.carrierName}
                hint={thirdParty ? undefined : "Opcional para flota propia"}
                id="history-dispatch-carrier"
                label={`Transporte${thirdParty ? " *" : ""}`}
              >
                <Input
                  disabled={submitting}
                  id="history-dispatch-carrier"
                  value={values.carrierName}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, carrierName: event.target.value }))
                  }
                />
              </FormField>
              <FormField
                error={errors.trackingNumber}
                hint={thirdParty ? undefined : "Opcional para flota propia"}
                id="history-dispatch-tracking"
                label={`Guía / tracking${thirdParty ? " *" : ""}`}
              >
                <Input
                  disabled={submitting}
                  id="history-dispatch-tracking"
                  value={values.trackingNumber}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, trackingNumber: event.target.value }))
                  }
                />
              </FormField>
            </div>
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
