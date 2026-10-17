"use client";

import { useState } from "react";
import type { BranchDto, BranchInputDto } from "@/modules/administration/application/dto/BranchDto";
import { BranchCard } from "@/modules/administration/components/BranchCard";
import { BranchDetailView } from "@/modules/administration/components/BranchDetailView";
import { BranchForm } from "@/modules/administration/components/BranchForm";
import { useBranches } from "@/modules/administration/hooks/useBranches";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PlusIcon } from "@/shared/components/icons";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { useToast } from "@/shared/components/Toast";

type ModalState =
  | { mode: "view"; branch: BranchDto }
  | { mode: "create" }
  | { mode: "edit"; branch: BranchDto }
  | null;

export function BranchesPage() {
  const { archive, branches, busy, canManage, canRead, create, error, loading, reload, update } =
    useBranches();
  const { showToast } = useToast();
  const [modal, setModal] = useState<ModalState>(null);
  const [archiveTarget, setArchiveTarget] = useState<BranchDto | null>(null);

  async function handleSubmit(value: BranchInputDto) {
    if (modal?.mode === "edit") {
      await update(modal.branch.id, value);
      showToast({ title: "Sucursal actualizada", tone: "success" });
    } else {
      await create(value);
      showToast({ title: "Sucursal creada", tone: "success" });
    }
    setModal(null);
  }

  async function handleArchive() {
    if (!archiveTarget) return;

    try {
      await archive(archiveTarget.id);
      showToast({
        title: "Sucursal archivada",
        description: "El registro y sus referencias históricas se conservaron.",
        tone: "success",
      });
      setArchiveTarget(null);
      setModal(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo archivar la sucursal",
        description:
          caughtError instanceof Error
            ? caughtError.message
            : "Inténtelo nuevamente en unos momentos.",
        tone: "danger",
      });
    }
  }

  function openView(branch: BranchDto) {
    setModal({ mode: "view", branch });
  }

  function openEditFromView(branch: BranchDto) {
    setModal({ mode: "edit", branch });
  }

  function openArchiveFromView(branch: BranchDto) {
    setArchiveTarget(branch);
  }

  if (!loading && !canRead) {
    return <AccessDeniedState />;
  }

  const modalTitle =
    modal?.mode === "edit"
      ? "Editar sucursal"
      : modal?.mode === "create"
        ? "Nueva sucursal"
        : "Detalle de sucursal";

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
              Nueva sucursal
            </Button>
          ) : null
        }
        description="Administre las sucursales operativas del negocio."
        title="Sucursales"
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
          Cargando sucursales...
        </div>
      ) : branches.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)] shadow-sm">
          Aún no hay sucursales registradas.
        </div>
      ) : (
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {branches.map((branch) => (
            <BranchCard key={branch.id} branch={branch} onSelect={openView} />
          ))}
        </div>
      )}

      <Modal
        onClose={() => setModal(null)}
        open={Boolean(modal)}
        size="lg"
        subtitle={modalSubtitle}
        title={modalTitle}
      >
        {modal?.mode === "view" ? (
          <BranchDetailView
            busy={busy}
            canManage={canManage}
            branch={modal.branch}
            onClose={() => setModal(null)}
            onEdit={() => openEditFromView(modal.branch)}
            onArchive={() => openArchiveFromView(modal.branch)}
          />
        ) : modal?.mode === "edit" ? (
          <BranchForm
            branch={modal.branch}
            busy={busy}
            key={modal.branch.id}
            onCancel={() => setModal({ mode: "view", branch: modal.branch })}
            onSubmit={handleSubmit}
          />
        ) : modal?.mode === "create" ? (
          <BranchForm
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
        message={`La sucursal ${archiveTarget?.name ?? "seleccionada"} dejará de estar activa, pero sus referencias e historial se conservarán.`}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void handleArchive()}
        open={Boolean(archiveTarget)}
        title="Archivar sucursal"
      />
    </div>
  );
}
