"use client";

import { Modal } from "@/shared/components/Modal";

export function StorefrontUnavailableQuantityModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      footer={
        <button
          className="w-full rounded-xl bg-[var(--color-primary-hover)] px-5 py-3 font-bold text-white transition hover:brightness-110"
          onClick={onClose}
          type="button"
        >
          Aceptar
        </button>
      }
      onClose={onClose}
      open={open}
      size="md"
      title="Lo sentimos"
    >
      <div className="flex flex-col items-center px-2 py-4 text-center sm:py-6">
        <span
          aria-hidden="true"
          className="grid h-14 w-14 place-items-center rounded-full border-2 border-[var(--color-primary-hover)] bg-[var(--color-primary)]/10 text-3xl font-light text-[var(--color-primary-hover)]"
        >
          ×
        </span>
        <p className="mt-5 text-base font-semibold text-[var(--color-text)]">
          Cantidad solicitada no disponible por el momento.
        </p>
      </div>
    </Modal>
  );
}
