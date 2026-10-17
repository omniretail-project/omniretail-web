import { BranchStatus, BranchType } from "@/core/enums";
import type { BranchDto } from "@/modules/administration/application/dto/BranchDto";
import { Button } from "@/shared/components/Button";
import { ArchiveIcon, MailIcon, MapPinIcon, PencilIcon, PhoneIcon } from "@/shared/components/icons";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { cn } from "@/shared/utils/cn";

const branchTypeLabels: Record<BranchType, string> = {
  [BranchType.main]: "Principal",
  [BranchType.store]: "Tienda",
  [BranchType.warehouse]: "Bodega",
};

interface BranchDetailViewProps {
  branch: BranchDto;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onClose: () => void;
}

export function BranchDetailView({ branch, canManage, busy, onEdit, onArchive }: BranchDetailViewProps) {
  const isArchived = branch.status === BranchStatus.archived;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-bold text-[var(--color-title)]">{branch.code}</h3>
        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
          {branchTypeLabels[branch.type]}
        </span>
        <StatusBadge status={branch.status} />
      </div>

      <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold text-[var(--color-text)]">
        {branch.name}
      </p>

      <dl className="grid gap-3 text-sm">
        <div className="flex min-w-0 items-start gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <dt className="w-28 shrink-0 font-medium text-[var(--color-text-muted)]">Dirección</dt>
          <dd className={cn("flex items-center gap-2", !branch.address && "italic text-[var(--color-text-muted)]")}>
            {branch.address ? <MapPinIcon className="h-4 w-4 shrink-0" /> : null}
            {branch.address ?? "Sin dirección"}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <dt className="w-28 shrink-0 font-medium text-[var(--color-text-muted)]">Teléfono</dt>
          <dd className={cn("flex items-center gap-2", !branch.phone && "italic text-[var(--color-text-muted)]")}>
            {branch.phone ? <PhoneIcon className="h-4 w-4 shrink-0" /> : null}
            {branch.phone ?? "Sin teléfono"}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <dt className="w-28 shrink-0 font-medium text-[var(--color-text-muted)]">Email</dt>
          <dd className={cn("flex items-center gap-2", !branch.email && "italic text-[var(--color-text-muted)]")}>
            {branch.email ? <MailIcon className="h-4 w-4 shrink-0" /> : null}
            {branch.email ?? "Sin correo"}
          </dd>
        </div>
      </dl>

      {canManage ? (
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
            {!isArchived ? (
              <Button className="gap-2" disabled={busy} onClick={onArchive} type="button" variant="danger">
                <ArchiveIcon className="h-4 w-4" />
                Archivar
              </Button>
            ) : null}
            <Button className="gap-2" disabled={busy} onClick={onEdit} type="button">
              <PencilIcon className="h-4 w-4" />
              Editar
            </Button>
        </div>
      ) : null}
    </div>
  );
}
