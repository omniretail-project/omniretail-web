"use client";

import { useState } from "react";
import type {
  BankAccountDto,
  BankAccountInputDto,
} from "@/modules/administration/application/dto/BankAccountDto";
import { BankAccountDetailView } from "@/modules/administration/components/BankAccountDetailView";
import { BankAccountForm } from "@/modules/administration/components/BankAccountForm";
import { BankAccountTable } from "@/modules/administration/components/BankAccountTable";
import { useBankAccounts } from "@/modules/administration/hooks/useBankAccounts";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PlusIcon } from "@/shared/components/icons";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { useToast } from "@/shared/components/Toast";

type ModalState =
  | { mode: "view"; account: BankAccountDto }
  | { mode: "create" }
  | { mode: "edit"; account: BankAccountDto }
  | null;

export function BankAccountsPage() {
  const {
    accounts,
    archive,
    branchNames,
    branchOptions,
    busy,
    canManage,
    create,
    error,
    loading,
    reload,
    update,
  } = useBankAccounts();
  const { showToast } = useToast();
  const [modal, setModal] = useState<ModalState>(null);
  const [archiveTarget, setArchiveTarget] = useState<BankAccountDto | null>(null);

  async function handleSubmit(value: BankAccountInputDto) {
    if (modal?.mode === "edit") {
      await update(modal.account.id, value);
      showToast({ title: "Cuenta bancaria actualizada", tone: "success" });
    } else {
      await create(value);
      showToast({ title: "Cuenta bancaria creada", tone: "success" });
    }
    setModal(null);
  }

  async function handleArchive() {
    if (!archiveTarget) return;

    try {
      await archive(archiveTarget.id);
      showToast({
        title: "Cuenta bancaria archivada",
        description: "El registro y sus referencias históricas se conservaron.",
        tone: "success",
      });
      setArchiveTarget(null);
      setModal(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo archivar la cuenta bancaria",
        description:
          caughtError instanceof Error
            ? caughtError.message
            : "Inténtelo nuevamente en unos momentos.",
        tone: "danger",
      });
    }
  }

  function openView(account: BankAccountDto) {
    setModal({ mode: "view", account });
  }

  function openEditFromView(account: BankAccountDto) {
    setModal({ mode: "edit", account });
  }

  function openArchiveFromView(account: BankAccountDto) {
    setArchiveTarget(account);
  }

  if (!loading && !canManage) {
    return <AccessDeniedState />;
  }

  const modalTitle =
    modal?.mode === "edit"
      ? "Editar cuenta bancaria"
      : modal?.mode === "create"
        ? "Nueva cuenta bancaria"
        : "Detalle de cuenta bancaria";

  const modalSubtitle =
    modal?.mode === "view"
      ? "Seleccione Editar o Archivar para realizar cambios."
      : "Los cambios se aplican únicamente al negocio activo.";

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        actions={
          canManage ? (
            <Button className="gap-2" onClick={() => setModal({ mode: "create" })} type="button">
              <PlusIcon className="h-4 w-4" />
              Nueva cuenta
            </Button>
          ) : null
        }
        description="Administre el maestro de cuentas bancarias del negocio."
        title="Cuentas bancarias"
      />

      {error ? (
        <InlineAlert
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          title={error}
          tone="danger"
        >
          <Button onClick={() => void reload()} type="button" variant="secondary">
            Reintentar
          </Button>
        </InlineAlert>
      ) : null}

      {loading ? (
        <div
          aria-live="polite"
          className="flex min-h-56 items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm font-medium text-[var(--color-text-muted)] shadow-sm"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]"
          />
          Cargando cuentas bancarias...
        </div>
      ) : (
        <BankAccountTable accounts={accounts} onSelect={openView} />
      )}

      <Modal
        onClose={() => setModal(null)}
        open={Boolean(modal)}
        size="lg"
        subtitle={modalSubtitle}
        title={modalTitle}
      >
        {modal?.mode === "view" ? (
          <BankAccountDetailView
            account={modal.account}
            branchNames={branchNames}
            busy={busy}
            canManage={canManage}
            onClose={() => setModal(null)}
            onEdit={() => openEditFromView(modal.account)}
            onArchive={() => openArchiveFromView(modal.account)}
          />
        ) : modal?.mode === "edit" ? (
          <BankAccountForm
            account={modal.account}
            branchOptions={branchOptions}
            busy={busy}
            key={modal.account.id}
            onCancel={() => setModal({ mode: "view", account: modal.account })}
            onSubmit={handleSubmit}
          />
        ) : modal?.mode === "create" ? (
          <BankAccountForm
            branchOptions={branchOptions}
            busy={busy}
            key="new"
            onCancel={() => setModal(null)}
            onSubmit={handleSubmit}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        cancelLabel="Cancelar"
        confirmLabel="Archivar"
        message={`La cuenta ${archiveTarget?.alias ?? "seleccionada"} dejará de estar activa, pero sus referencias e historial se conservarán.`}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void handleArchive()}
        open={Boolean(archiveTarget)}
        title="Archivar cuenta bancaria"
      />
    </div>
  );
}
