"use client";

import { useState } from "react";
import type {
  EmployeeDto,
  EmployeeInputDto,
} from "@/modules/administration/application/dto/EmployeeDto";
import { EmployeeForm } from "@/modules/administration/components/EmployeeForm";
import { EmployeeTable } from "@/modules/administration/components/EmployeeTable";
import { useEmployees } from "@/modules/administration/hooks/useEmployees";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Button } from "@/shared/components/Button";
import { UserPlusIcon } from "@/shared/components/icons";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { TableSkeleton } from "@/shared/components/TableSkeleton";
import { useToast } from "@/shared/components/Toast";

type EditorState = { mode: "create" } | { mode: "edit"; employee: EmployeeDto } | null;

export function EmployeesPage() {
  const {
    branchNames,
    branchOptions,
    busy,
    canManage,
    canRead,
    create,
    employees,
    error,
    loading,
    reload,
    resendInvitation,
    roleNames,
    roleOptions,
    update,
  } = useEmployees();
  const { showToast } = useToast();
  const [editor, setEditor] = useState<EditorState>(null);
  const [invitationLink, setInvitationLink] = useState<{
    employeeName: string;
    token: string;
  } | null>(null);

  async function handleSubmit(value: EmployeeInputDto) {
    if (editor?.mode === "edit") {
      await update(editor.employee.id, value);
      showToast({ title: "Empleado actualizado", tone: "success" });
    } else {
      const result = await create(value);
      showToast({
        title: "Empleado creado",
        description: "Se envió la invitación para que active su cuenta.",
        tone: "success",
      });
      if (result.invitationToken) {
        setInvitationLink({ employeeName: result.employee.name, token: result.invitationToken });
      }
    }
    setEditor(null);
  }

  async function handleResendInvitation(employee: EmployeeDto) {
    try {
      const result = await resendInvitation(employee.id);
      showToast({
        title: "Invitación enviada",
        description: `${employee.name} puede activar su cuenta con el nuevo enlace.`,
        tone: "success",
      });
      if (result.invitationToken) {
        setInvitationLink({ employeeName: employee.name, token: result.invitationToken });
      }
    } catch (caughtError) {
      showToast({
        title: "No se pudo enviar la invitación",
        description:
          caughtError instanceof Error
            ? caughtError.message
            : "Inténtelo nuevamente en unos momentos.",
        tone: "danger",
      });
    }
  }

  async function handleCopyInvitation(employee: EmployeeDto) {
    try {
      const result = await resendInvitation(employee.id);
      if (result.invitationToken) {
        const link = `${window.location.origin}/activar-cuenta/${result.invitationToken}`;
        await navigator.clipboard.writeText(link);
        showToast({
          title: "Enlace copiado",
          description: `El enlace de activación de ${employee.name} se copió al portapapeles.`,
          tone: "success",
        });
      }
    } catch (caughtError) {
      showToast({
        title: "No se pudo copiar el enlace",
        description:
          caughtError instanceof Error
            ? caughtError.message
            : "Inténtelo nuevamente en unos momentos.",
        tone: "danger",
      });
    }
  }

  if (!loading && !canRead) {
    return <AccessDeniedState />;
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        actions={
          canManage ? (
            <Button className="gap-2" onClick={() => setEditor({ mode: "create" })} type="button">
              <UserPlusIcon className="h-4 w-4" />
              Nuevo empleado
            </Button>
          ) : null
        }
        description="Administre los empleados del negocio."
        title="Usuarios"
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
        <TableSkeleton columnsCount={5} label="Cargando empleados" rowCount={4} />
      ) : (
        <section className="min-w-0">
          <EmployeeTable
            branchNames={branchNames}
            busy={busy}
            canManage={canManage}
            employees={employees}
            onEdit={(employee) => setEditor({ mode: "edit", employee })}
            onResendInvitation={(employee) => void handleResendInvitation(employee)}
            onCopyInvitation={(employee) => void handleCopyInvitation(employee)}
            roleNames={roleNames}
          />
        </section>
      )}

      <Modal
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        size="lg"
        subtitle="Los cambios se aplican únicamente al negocio activo."
        title={editor?.mode === "edit" ? "Editar empleado" : "Nuevo empleado"}
      >
        {editor ? (
          <EmployeeForm
            branchOptions={branchOptions}
            busy={busy}
            employee={editor.mode === "edit" ? editor.employee : undefined}
            key={editor.mode === "edit" ? editor.employee.id : "new"}
            onCancel={() => setEditor(null)}
            onSubmit={handleSubmit}
            roleOptions={roleOptions}
          />
        ) : null}
      </Modal>

      <InvitationLinkModal invitation={invitationLink} onClose={() => setInvitationLink(null)} />
    </div>
  );
}

function InvitationLinkModal({
  invitation,
  onClose,
}: {
  invitation: { employeeName: string; token: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = invitation ? `${window.location.origin}/activar-cuenta/${invitation.token}` : "";

  async function handleCopy() {
    if (!invitation) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  function handleClose() {
    setCopied(false);
    onClose();
  }

  return (
    <Modal
      onClose={handleClose}
      open={Boolean(invitation)}
      size="md"
      subtitle="Compártalo solo con la persona invitada; no queda guardado y esta es la única vez que se muestra."
      title="Invitación generada correctamente"
    >
      {invitation ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            {invitation.employeeName} puede activar su cuenta con este enlace.
          </p>
          <div className="break-all rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 text-xs text-[var(--color-text)]">
            {link}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => void handleCopy()} type="button" variant="secondary">
              {copied ? "Copiado ✓" : "Copiar enlace"}
            </Button>
            <Button href={link} rel="noopener noreferrer" target="_blank">
              Abrir activación
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
