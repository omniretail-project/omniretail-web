import { BranchStatus, BranchType } from "@/core/enums";
import type { BranchDto } from "@/modules/administration/application/dto/BranchDto";
import { MailIcon, MapPinIcon, PhoneIcon } from "@/shared/components/icons";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { cn } from "@/shared/utils/cn";

const branchTypeLabels: Record<BranchType, string> = {
  [BranchType.main]: "Principal",
  [BranchType.store]: "Tienda",
  [BranchType.warehouse]: "Bodega",
};

const branchTypeTones: Record<BranchType, string> = {
  [BranchType.main]: "bg-indigo-100 text-indigo-800",
  [BranchType.store]: "bg-sky-100 text-sky-800",
  [BranchType.warehouse]: "bg-amber-100 text-amber-800",
};

interface BranchCardProps {
  branch: BranchDto;
  onSelect: (branch: BranchDto) => void;
}

export function BranchCard({ branch, onSelect }: BranchCardProps) {
  const isArchived = branch.status === BranchStatus.archived;

  return (
    <button
      className={cn(
        "flex h-full min-w-0 w-full cursor-pointer flex-col rounded-xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] motion-reduce:transform-none motion-reduce:transition-none",
        isArchived
          ? "border-slate-200 bg-slate-50 opacity-75 hover:opacity-100"
          : "border-[var(--color-border)] bg-[var(--color-surface)]",
      )}
      onClick={() => onSelect(branch)}
      type="button"
    >
      <div className="flex w-full min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "text-xs font-bold uppercase tracking-wide",
                isArchived ? "text-slate-400" : "text-[var(--color-structure)]",
              )}
            >
              {branch.code}
            </span>
            <span
              className={cn(
                "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold",
                branchTypeTones[branch.type],
                isArchived && "opacity-60",
              )}
            >
              {branchTypeLabels[branch.type]}
            </span>
          </div>
          <h3
            className={cn(
              "mt-2 break-words text-base font-bold leading-5",
              isArchived ? "text-slate-400" : "text-[var(--color-title)]",
            )}
          >
            {branch.name}
          </h3>
        </div>
        <StatusBadge status={branch.status} />
      </div>

      <dl
        className={cn(
          "mt-4 w-full min-w-0 flex-1 space-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm",
          isArchived ? "text-slate-400" : "text-[var(--color-text-muted)]",
        )}
      >
        {branch.address ? (
          <div className="flex min-w-0 items-start gap-2">
            <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <dd className="min-w-0 break-words leading-5">{branch.address}</dd>
          </div>
        ) : null}
        {branch.phone ? (
          <div className="flex min-w-0 items-center gap-2">
            <PhoneIcon className="h-4 w-4 shrink-0" />
            <dd className="min-w-0 break-words">{branch.phone}</dd>
          </div>
        ) : null}
        {branch.email ? (
          <div className="flex min-w-0 items-center gap-2">
            <MailIcon className="h-4 w-4 shrink-0" />
            <dd className="min-w-0 break-all">{branch.email}</dd>
          </div>
        ) : null}
        {!branch.address && !branch.phone && !branch.email ? (
          <p className="italic">Sin datos de contacto.</p>
        ) : null}
      </dl>
    </button>
  );
}
