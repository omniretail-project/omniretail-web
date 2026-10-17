"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { CashShiftDto } from "@/modules/administration/application/dto/CashShiftDto";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { Modal } from "@/shared/components/Modal";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { cn } from "@/shared/utils/cn";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import { formatDate } from "@/shared/utils/formatDate";

interface CashShiftTableProps {
  actorNames: ReadonlyMap<string, string>;
  branchNames: ReadonlyMap<string, string>;
  shifts: CashShiftDto[];
}

export function CashShiftTable({ actorNames, branchNames, shifts }: CashShiftTableProps) {
  const [selectedShift, setSelectedShift] = useState<CashShiftDto | null>(null);
  const columns = useMemo<DataTableColumn<CashShiftDto>[]>(
    () => [
      {
        key: "branch",
        header: "Sucursal",
        cell: (shift) => (
          <span className="font-medium text-[var(--color-title)]">
            {branchNames.get(shift.branchId) ?? shift.branchId}
          </span>
        ),
      },
      {
        key: "cashier",
        header: "Cajero",
        cell: (shift) => (
          <span className="text-[var(--color-text)]">
            {actorNames.get(shift.userId) ?? shift.userId}
          </span>
        ),
      },
      {
        key: "register",
        header: "Caja",
        cell: (shift) => (
          <span className="font-mono font-semibold text-[var(--color-title)]">
            {shift.registerCode}
          </span>
        ),
      },
      {
        key: "opening",
        header: "Apertura",
        cell: (shift) => (
          <div>
            <p className="font-medium text-[var(--color-title)]">{formatDate(shift.openedAt)}</p>
            <p className="mt-1 text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
              {formatCurrency(shift.openingAmount)}
            </p>
          </div>
        ),
      },
      {
        key: "expected",
        header: "Esperado",
        cell: (shift) => (
          <span className="font-medium tabular-nums">{formatOptionalAmount(shift.expectedAmount)}</span>
        ),
        className: "text-right whitespace-nowrap",
      },
      {
        key: "counted",
        header: "Contado",
        cell: (shift) => (
          <span className="font-medium tabular-nums">{formatOptionalAmount(shift.countedAmount)}</span>
        ),
        className: "text-right whitespace-nowrap",
      },
      {
        key: "difference",
        header: "Diferencia",
        cell: (shift) => (
          <span
            className={cn(
              "font-semibold tabular-nums",
              shift.difference != null && shift.difference !== 0
                ? "text-[var(--color-danger)]"
                : "text-[var(--color-text)]",
            )}
          >
            {formatOptionalAmount(shift.difference)}
          </span>
        ),
        className: "text-right whitespace-nowrap",
      },
      {
        key: "status",
        header: "Estado",
        cell: (shift) => <StatusBadge status={shift.status} />,
      },
    ],
    [actorNames, branchNames],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={shifts}
        emptyMessage="No hay turnos de caja para los filtros actuales."
        headerClassName="bg-[var(--color-structure)] text-white [&_th]:text-white"
        onRowClick={setSelectedShift}
        rowKey={(shift) => shift.id}
      />
      <CashShiftDetailModal
        actorName={
          selectedShift ? (actorNames.get(selectedShift.userId) ?? selectedShift.userId) : undefined
        }
        branchName={
          selectedShift
            ? (branchNames.get(selectedShift.branchId) ?? selectedShift.branchId)
            : undefined
        }
        shift={selectedShift}
        onClose={() => setSelectedShift(null)}
      />
    </>
  );
}

function CashShiftDetailModal({
  actorName,
  branchName,
  shift,
  onClose,
}: {
  actorName?: string;
  branchName?: string;
  shift: CashShiftDto | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(shift)}
      size="lg"
      subtitle={shift ? `${branchName} · ${actorName}` : undefined}
      title={shift ? `Turno ${shift.registerCode}` : "Detalle del turno"}
      onClose={onClose}
    >
      {shift ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={shift.status} />
            <span className="text-sm font-medium text-[var(--color-text-muted)]">{shift.id}</span>
          </div>
          <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailItem label="Sucursal" value={branchName ?? shift.branchId} />
            <DetailItem label="Cajero" value={actorName ?? shift.userId} />
            <DetailItem label="Caja" value={shift.registerCode} />
            <DetailItem label="Estado" value={<StatusBadge status={shift.status} />} />
            <DetailItem label="Fecha de apertura" value={formatDate(shift.openedAt)} />
            <DetailItem label="Monto de apertura" value={formatCurrency(shift.openingAmount)} />
            <DetailItem
              label="Fecha de cierre"
              value={shift.closedAt ? formatDate(shift.closedAt) : "—"}
            />
            <DetailItem label="Monto esperado" value={formatOptionalAmount(shift.expectedAmount)} />
            <DetailItem label="Monto contado" value={formatOptionalAmount(shift.countedAmount)} />
            <DetailItem label="Diferencia" value={formatOptionalAmount(shift.difference)} />
          </dl>
          <p className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-surface)] px-4 py-3 text-sm leading-5 text-[var(--color-text)]">
            El desglose de movimientos no está disponible: el contrato de caja no expone
            CashMovement.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function formatOptionalAmount(value?: number) {
  return value != null ? formatCurrency(value) : "—";
}
