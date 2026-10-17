"use client";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onCancel} type="button" variant="secondary">
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} type="button" variant="danger">
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-[var(--color-text)]">{message}</p>
    </Modal>
  );
}
