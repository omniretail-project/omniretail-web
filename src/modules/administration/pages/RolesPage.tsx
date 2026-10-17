"use client";

import { useState } from "react";
import type { RoleDto, RoleInputDto } from "@/modules/administration/application/dto/RoleDto";
import { RoleDetailView } from "@/modules/administration/components/RoleDetailView";
import { RoleForm } from "@/modules/administration/components/RoleForm";
import { RoleTable } from "@/modules/administration/components/RoleTable";
import { useRoles } from "@/modules/administration/hooks/useRoles";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PlusIcon } from "@/shared/components/icons";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { TableSkeleton } from "@/shared/components/TableSkeleton";
import { useToast } from "@/shared/components/Toast";

type ModalState =
  | { mode: "view"; role: RoleDto }
  | { mode: "create" }
  | { mode: "edit"; role: RoleDto }
  | null;

export function RolesPage() {
  const {
    actorPermissions,
    archive,
    busy,
    canManage,
    canRead,
    create,
    error,
    loading,
    reload,
    roles,
    update,
  } = useRoles();
  const { showToast } = useToast();
  const [modal, setModal] = useState<ModalState>(null);
  const [archiveTarget, setArchiveTarget] = useState<RoleDto | null>(null);

  async function handleSubmit(value: RoleInputDto) {
    if (modal?.mode === "edit") {
      await update(modal.role.id, value);
      showToast({ title: "Rol actualizado", tone: "success" });
    } else {
      await create(value);
      showToast({ title: "Rol creado", tone: "success" });
    }
    setModal(null);
  }

  async function handleArchive() {
    if (!archiveTarget) return;

    try {
      await archive(archiveTarget.id);
      showToast({
        title: "Rol archivado",
        description: "Las cuentas que ya lo tenían asignado conservan su acceso actual.",
        tone: "success",
      });
      setArchiveTarget(null);
      setModal(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo archivar el rol",
        description:
          caughtError instanceof Error
            ? caughtError.message
            : "Inténtelo nuevamente en unos momentos.",
        tone: "danger",
      });
    }
  }

  function openView(role: RoleDto) {
    setModal({ mode: "view", role });
  }

  function openEditFromView(role: RoleDto) {
    setModal({ mode: "edit", role });
  }

  function openArchiveFromView(role: RoleDto) {
    setArchiveTarget(role);
  }

  if (!loading && !canRead) {
    return <AccessDeniedState />;
  }

  const modalTitle =
    modal?.mode === "edit"
      ? "Editar rol"
      : modal?.mode === "create"
        ? "Nuevo rol"
        : "Detalle del rol";

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
              Nuevo rol
            </Button>
          ) : null
        }
        description="Defina roles y los permisos disponibles para cada uno."
        title="Roles y permisos"
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
        <TableSkeleton columnsCount={4} label="Cargando roles" rowCount={3} />
      ) : (
        <section className="min-w-0">
          <RoleTable roles={roles} onSelect={openView} />
        </section>
      )}

      <Modal
        onClose={() => setModal(null)}
        open={Boolean(modal)}
        size="lg"
        subtitle={modalSubtitle}
        title={modalTitle}
      >
        {modal?.mode === "view" ? (
          <RoleDetailView
            busy={busy}
            canManage={canManage}
            onClose={() => setModal(null)}
            onEdit={() => openEditFromView(modal.role)}
            onArchive={() => openArchiveFromView(modal.role)}
            role={modal.role}
          />
        ) : modal?.mode === "edit" ? (
          <RoleForm
            actorPermissions={actorPermissions}
            busy={busy}
            key={modal.role.id}
            onCancel={() => setModal({ mode: "view", role: modal.role })}
            onSubmit={handleSubmit}
            role={modal.role}
          />
        ) : modal?.mode === "create" ? (
          <RoleForm
            actorPermissions={actorPermissions}
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
        message={`El rol ${archiveTarget?.name ?? "seleccionado"} dejará de estar activo. Las cuentas que ya lo tienen asignado no pierden acceso automáticamente.`}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void handleArchive()}
        open={Boolean(archiveTarget)}
        title="Archivar rol"
      />
    </div>
  );
}
