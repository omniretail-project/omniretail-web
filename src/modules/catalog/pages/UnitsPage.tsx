"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { UnitCategory, UnitStatus } from "@/core/enums";
import { Button } from "@/shared/components/Button";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { Input } from "@/shared/components/Input";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Select } from "@/shared/components/Select";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { useToast } from "@/shared/components/Toast";
import { cn } from "@/shared/utils/cn";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";
import type { UnitEditorDto, UnitListItem } from "@/modules/catalog/application/dto/UnitEditorDto";
import { UNIT_CATEGORY_LABELS } from "@/modules/catalog/application/services/GetUnitsService";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
} from "@/modules/catalog/components/CatalogIcons";
import {
  useUnits,
  type UnitCategoryFilter,
  type UnitStatusFilter,
} from "@/modules/catalog/hooks/useUnits";
import {
  buildDefaultUnitDto,
  hasUnitValidationErrors,
  unitToDto,
  validateUnitDto,
  type UnitValidationErrors,
} from "@/modules/catalog/validation/unit.validation";

type PanelMode = "detail" | "create" | "edit";
type PanelState = { mode: PanelMode; unit?: UnitListItem } | null;

const UNIT_CATEGORIES = Object.entries(UNIT_CATEGORY_LABELS) as [UnitCategory, string][];

export function UnitsPage() {
  const { showToast } = useToast();
  const {
    loading,
    busy,
    error,
    canRead,
    canManage,
    units,
    filteredUnits,
    paginatedUnits,
    search,
    category,
    status,
    page,
    pageSize,
    totalPages,
    setSearch,
    setCategory,
    setStatus,
    setPage,
    setPageSize,
    create,
    update,
    archive,
    restore,
  } = useUnits();
  const [panel, setPanel] = useState<PanelState>(null);
  const [archiveTarget, setArchiveTarget] = useState<UnitListItem | null>(null);
  const selectedUnit = panel?.unit && units.find((unit) => unit.id === panel.unit?.id);
  const panelUnit = selectedUnit ?? panel?.unit;
  const firstVisible = filteredUnits.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min(page * pageSize, filteredUnits.length);

  async function handleCreate(dto: UnitEditorDto) {
    const created = await create(dto);
    if (created) setPanel({ mode: "detail", unit: created });
    showToast({ title: "Unidad creada", tone: "success" });
  }

  async function handleUpdate(dto: UnitEditorDto) {
    if (!panelUnit) return;
    const updated = await update(panelUnit.id, dto);
    if (updated) setPanel({ mode: "detail", unit: updated });
    showToast({ title: "Unidad actualizada", tone: "success" });
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    await archive(archiveTarget.id);
    showToast({ title: "Unidad archivada", tone: "success" });
    if (panelUnit?.id === archiveTarget.id) {
      setPanel({
        mode: "detail",
        unit: { ...archiveTarget, status: UnitStatus.archived },
      });
    }
    setArchiveTarget(null);
  }

  async function handleRestore(unit: UnitListItem) {
    await restore(unit.id);
    showToast({ title: "Unidad reactivada", tone: "success" });
    setPanel({ mode: "detail", unit: { ...unit, status: UnitStatus.active } });
  }

  if (!loading && !canRead) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
        <header className="border-b border-[var(--color-border)] pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            CONFIGURACION
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[var(--color-title)]">Unidades</h1>
        </header>
        <AccessDeniedState />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <header className="flex min-w-0 flex-col gap-4 border-b border-[var(--color-border)] pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            CONFIGURACION
          </p>
          <h1 className="mt-1 break-words text-2xl font-bold text-[var(--color-title)]">
            Unidades
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Administra las unidades que se usan para inventario, venta y compra de productos.
          </p>
        </div>
        {canManage ? (
          <Button
            className="w-full sm:w-auto"
            onClick={() => setPanel({ mode: "create" })}
            type="button"
          >
            <PlusIcon />
            Nueva unidad
          </Button>
        ) : null}
      </header>

      {error ? <InlineAlert title={error} tone="danger" /> : null}

      <section
        className={cn(
          "grid max-w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-sm",
          panel ? "lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]" : "",
        )}
      >
        <div className="min-w-0">
          <UnitFilters
            category={category}
            search={search}
            status={status}
            onCategoryChange={setCategory}
            onSearchChange={setSearch}
            onStatusChange={setStatus}
          />
          {loading ? (
            <p className="border-t border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]">
              Cargando unidades...
            </p>
          ) : (
            <UnitTable
              canManage={canManage}
              emptyMessage={
                units.length === 0
                  ? "Aun no hay unidades registradas."
                  : "No hay unidades que coincidan con los filtros."
              }
              onArchive={setArchiveTarget}
              onEdit={(unit) => setPanel({ mode: "edit", unit })}
              onOpen={(unit) => setPanel({ mode: "detail", unit })}
              onRestore={handleRestore}
              units={paginatedUnits}
            />
          )}
          {filteredUnits.length > 0 ? (
            <UnitTableFooter
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              page={page}
              pageSize={pageSize}
              totalItems={filteredUnits.length}
              totalPages={totalPages}
            />
          ) : null}
        </div>

        {panel ? (
          <UnitPanel
            busy={busy}
            canManage={canManage}
            mode={panel.mode}
            onCancel={() =>
              panel.mode === "detail"
                ? setPanel(null)
                : setPanel(panelUnit ? { mode: "detail", unit: panelUnit } : null)
            }
            onClose={() => setPanel(null)}
            onEdit={() => panelUnit && setPanel({ mode: "edit", unit: panelUnit })}
            onSubmit={panel.mode === "create" ? handleCreate : handleUpdate}
            unit={panelUnit}
            units={units}
          />
        ) : null}
      </section>

      <ConfirmDialog
        confirmLabel="Archivar"
        message={buildArchiveMessage(archiveTarget)}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
        open={Boolean(archiveTarget)}
        title="Archivar unidad"
      />
    </div>
  );
}

function UnitFilters({
  category,
  search,
  status,
  onCategoryChange,
  onSearchChange,
  onStatusChange,
}: {
  category: UnitCategoryFilter;
  search: string;
  status: UnitStatusFilter;
  onCategoryChange: (value: UnitCategoryFilter) => void;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: UnitStatusFilter) => void;
}) {
  return (
    <div className="grid gap-3 p-4 xl:grid-cols-[minmax(0,1fr)_220px_auto] xl:items-center">
      <Input
        aria-label="Buscar unidades"
        maxLength={TEXT_LIMITS.search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Buscar por nombre o simbolo..."
        type="search"
        value={search}
      />
      <Select
        aria-label="Filtrar por categoria"
        onChange={(event) => onCategoryChange(event.target.value as UnitCategoryFilter)}
        value={category}
      >
        <option value="all">Todas las categorias</option>
        {UNIT_CATEGORIES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <StatusFilterButton
          active={status === UnitStatus.active}
          onClick={() => onStatusChange(UnitStatus.active)}
        >
          Activas
        </StatusFilterButton>
        <StatusFilterButton
          active={status === UnitStatus.archived}
          onClick={() => onStatusChange(UnitStatus.archived)}
        >
          Archivadas
        </StatusFilterButton>
      </div>
    </div>
  );
}

function StatusFilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
          : "border-[var(--color-border)] bg-white text-[var(--color-title)] hover:bg-[var(--color-app-background)]",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function UnitTable({
  canManage,
  emptyMessage,
  onArchive,
  onEdit,
  onOpen,
  onRestore,
  units,
}: {
  canManage: boolean;
  emptyMessage: string;
  onArchive: (unit: UnitListItem) => void;
  onEdit: (unit: UnitListItem) => void;
  onOpen: (unit: UnitListItem) => void;
  onRestore: (unit: UnitListItem) => void;
  units: UnitListItem[];
}) {
  return (
    <div className="overflow-x-auto border-t border-[var(--color-border)]">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm lg:min-w-[720px]">
        <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
          <tr>
            <th className="px-4 py-3 font-semibold">Unidad</th>
            <th className="hidden px-4 py-3 font-semibold md:table-cell">Categoria</th>
            <th className="px-4 py-3 text-right font-semibold">Decimales</th>
            <th className="w-24 px-4 py-3 text-right font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {units.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-[var(--color-text-muted)]" colSpan={4}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            units.map((unit) => (
              <tr
                className="cursor-pointer border-t border-[var(--color-border)] transition hover:bg-[var(--color-primary)]/5 focus:bg-[var(--color-primary)]/5 focus:outline focus:outline-2 focus:outline-inset focus:outline-[var(--color-structure)]"
                key={unit.id}
                onClick={() => onOpen(unit)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(unit);
                }}
                tabIndex={0}
              >
                <td className="min-w-[220px] px-4 py-3">
                  <p className="font-semibold text-[var(--color-title)]">{unit.name}</p>
                  <p className="mt-1 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                    {unit.symbol}
                  </p>
                </td>
                <td className="hidden px-4 py-3 font-semibold text-[var(--color-text)] md:table-cell">
                  {unit.categoryLabel}
                </td>
                <td className="px-4 py-3 text-right font-bold text-[var(--color-title)]">
                  {unit.allowsDecimals ? "Si" : "No"}
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <UnitActionsMenu
                      onArchive={onArchive}
                      onEdit={onEdit}
                      onRestore={onRestore}
                      unit={unit}
                    />
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function UnitActionsMenu({
  onArchive,
  onEdit,
  onRestore,
  unit,
}: {
  onArchive: (unit: UnitListItem) => void;
  onEdit: (unit: UnitListItem) => void;
  onRestore: (unit: UnitListItem) => void;
  unit: UnitListItem;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function updateMenuPosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = 104;
      const hasSpaceBelow = window.innerHeight - rect.bottom >= menuHeight + 12;
      setMenuStyle({
        right: Math.max(12, window.innerWidth - rect.right),
        top: hasSpaceBelow ? rect.bottom + 6 : Math.max(12, rect.top - menuHeight - 6),
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function select(action: (unit: UnitListItem) => void) {
    setOpen(false);
    action(unit);
  }

  return (
    <div
      className="relative flex justify-end"
      onClick={(event) => event.stopPropagation()}
      ref={containerRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Acciones de ${unit.name}`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] bg-white text-xl font-bold leading-none text-[var(--color-title)] transition hover:border-[var(--color-structure)] hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        ⋮
      </button>
      {open ? (
        <div
          className="fixed z-50 w-[min(14rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--color-border)] bg-white py-2 shadow-lg"
          role="menu"
          style={menuStyle}
        >
          <MenuItem icon={<PencilIcon />} onClick={() => select(onEdit)}>
            Editar
          </MenuItem>
          {unit.status === UnitStatus.active ? (
            <MenuItem destructive icon={<ArchiveIcon />} onClick={() => select(onArchive)}>
              Archivar
            </MenuItem>
          ) : (
            <MenuItem icon={<CheckIcon />} onClick={() => select(onRestore)}>
              Reactivar
            </MenuItem>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  destructive,
  icon,
  onClick,
}: {
  children: string;
  destructive?: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-structure)]",
        destructive ? "text-[var(--color-danger)]" : "text-[var(--color-text)]",
      )}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className={destructive ? "text-[var(--color-danger)]" : "text-[var(--color-title)]"}>
        {icon}
      </span>
      {children}
    </button>
  );
}

function UnitTableFooter({
  firstVisible,
  lastVisible,
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  firstVisible: number;
  lastVisible: number;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--color-text-muted)]">
          Mostrando {firstVisible}-{lastVisible} de {totalItems} unidades
        </p>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          Filas
          <Select
            aria-label="Filas por pagina"
            className="h-9 w-20 px-2"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            value={pageSize}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </Select>
        </label>
      </div>
      <nav
        aria-label="Paginacion de unidades"
        className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start"
      >
        <Button
          aria-label="Pagina anterior"
          className="min-h-9 px-3 py-1.5"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
          variant="secondary"
        >
          <ChevronLeftIcon />
        </Button>
        <span className="min-w-12 text-center text-sm font-semibold text-[var(--color-text)]">
          {page} / {totalPages}
        </span>
        <Button
          aria-label="Pagina siguiente"
          className="min-h-9 px-3 py-1.5"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
          variant="secondary"
        >
          <ChevronRightIcon />
        </Button>
      </nav>
    </div>
  );
}

function UnitPanel({
  busy,
  canManage,
  mode,
  onCancel,
  onClose,
  onEdit,
  onSubmit,
  unit,
  units,
}: {
  busy: boolean;
  canManage: boolean;
  mode: PanelMode;
  onCancel: () => void;
  onClose: () => void;
  onEdit: () => void;
  onSubmit: (dto: UnitEditorDto) => Promise<void>;
  unit?: UnitListItem;
  units: UnitListItem[];
}) {
  const isForm = mode !== "detail";

  return (
    <>
      <button
        aria-label="Cerrar panel de unidad"
        className="fixed inset-0 z-30 bg-[var(--color-topbar)]/25 lg:hidden"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={mode === "detail" ? "Detalle de unidad" : "Formulario de unidad"}
        className="fixed inset-x-3 bottom-3 top-3 z-40 flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-xl lg:static lg:z-auto lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              {mode === "detail"
                ? "Detalle de unidad"
                : mode === "create"
                  ? "Nueva unidad"
                  : "Editar unidad"}
            </p>
            <h2 className="mt-1 break-words text-lg font-bold text-[var(--color-title)]">
              {mode === "create" ? "Nueva unidad" : (unit?.name ?? "Unidad")}
            </h2>
          </div>
          <button
            aria-label="Cerrar"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-bold text-[var(--color-title)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isForm ? (
            <UnitForm
              busy={busy}
              mode={mode}
              onCancel={onCancel}
              onSubmit={onSubmit}
              unit={unit}
              units={units}
            />
          ) : unit ? (
            <UnitDetail canManage={canManage} onClose={onClose} onEdit={onEdit} unit={unit} />
          ) : null}
        </div>
      </aside>
    </>
  );
}

function UnitDetail({
  canManage,
  onClose,
  onEdit,
  unit,
}: {
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  unit: UnitListItem;
}) {
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] bg-white px-4">
        <DetailItem label="Nombre" value={unit.name} />
        <DetailItem label="Simbolo" value={unit.symbol} />
        <DetailItem label="Categoria" value={unit.categoryLabel} />
        <DetailItem label="Permite decimales" value={unit.allowsDecimals ? "Si" : "No"} />
        <DetailItem label="Estado" value={<StatusBadge status={unit.status} />} />
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button className="w-full sm:w-auto" onClick={onClose} type="button" variant="secondary">
          Cerrar
        </Button>
        {canManage ? (
          <Button className="w-full sm:w-auto" onClick={onEdit} type="button">
            <PencilIcon />
            Editar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-3">
      <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

function UnitForm({
  busy,
  mode,
  onCancel,
  onSubmit,
  unit,
  units,
}: {
  busy: boolean;
  mode: PanelMode;
  onCancel: () => void;
  onSubmit: (dto: UnitEditorDto) => Promise<void>;
  unit?: UnitListItem;
  units: UnitListItem[];
}) {
  const [value, setValue] = useState<UnitEditorDto>(() =>
    unit ? unitToDto(unit) : buildDefaultUnitDto(),
  );
  const [errors, setErrors] = useState<UnitValidationErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateUnitDto(value, units, unit?.id);
    setErrors(nextErrors);
    if (hasUnitValidationErrors(nextErrors)) return;
    await onSubmit(value);
  }

  function update(patch: Partial<UnitEditorDto>) {
    const nextValue = { ...value, ...patch };
    setValue(nextValue);
    setErrors((currentErrors) => {
      const validation = validateUnitDto(nextValue, units, unit?.id);
      const nextErrors = { ...currentErrors };
      for (const field of Object.keys(patch) as Array<keyof UnitValidationErrors>) {
        if (!currentErrors[field]) continue;
        if (validation[field]) nextErrors[field] = validation[field];
        else delete nextErrors[field];
      }
      return nextErrors;
    });
  }

  return (
    <form className="space-y-4" id="catalog-unit-form" noValidate onSubmit={submit}>
      <Field error={errors.name} id="unit-name" label="Nombre *">
        <Input
          id="unit-name"
          maxLength={TEXT_LIMITS.unitName}
          onChange={(event) => update({ name: event.target.value })}
          value={value.name}
        />
      </Field>
      <Field error={errors.symbol} id="unit-symbol" label="Simbolo *">
        <Input
          id="unit-symbol"
          maxLength={TEXT_LIMITS.unitSymbol}
          onChange={(event) => update({ symbol: event.target.value })}
          placeholder="kg"
          value={value.symbol}
        />
      </Field>
      <Field error={errors.category} id="unit-category" label="Categoria *">
        <Select
          id="unit-category"
          onChange={(event) => update({ category: event.target.value as UnitCategory })}
          value={value.category}
        >
          {UNIT_CATEGORIES.map(([category, label]) => (
            <option key={category} value={category}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-start gap-3 rounded-md border border-[var(--color-border)] bg-white p-3 text-sm font-semibold text-[var(--color-text)]">
        <input
          checked={value.allowsDecimals}
          className="mt-1 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
          onChange={(event) => update({ allowsDecimals: event.target.checked })}
          type="checkbox"
        />
        <span className="min-w-0">
          <span className="block">Permitir cantidades decimales</span>
          <span className="mt-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Util para peso, longitud o volumen cuando el producto se vende en fracciones.
          </span>
        </span>
      </label>
      <Field id="unit-status" label="Estado">
        <Select
          id="unit-status"
          onChange={(event) => update({ status: event.target.value as UnitStatus })}
          value={value.status}
        >
          <option value={UnitStatus.active}>Activa</option>
          <option value={UnitStatus.archived}>Archivada</option>
        </Select>
      </Field>
      <footer className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
        <Button className="w-full sm:w-auto" onClick={onCancel} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button className="w-full sm:w-auto" disabled={busy} type="submit">
          <CheckIcon />
          {busy ? "Guardando..." : mode === "create" ? "Guardar unidad" : "Guardar cambios"}
        </Button>
      </footer>
    </form>
  );
}

function Field({
  children,
  error,
  id,
  label,
}: {
  children: ReactNode;
  error?: string;
  id: string;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-[var(--color-text)]" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? <p className="text-sm font-semibold text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

function buildArchiveMessage(unit: UnitListItem | null) {
  if (!unit) return "La unidad dejara de estar disponible, pero se conservara su historial.";

  const hasReferences = unit.productReferenceCount > 0 || unit.conversionReferenceCount > 0;
  if (!hasReferences) {
    return "La unidad dejara de estar disponible, pero se conservara su historial.";
  }

  return "La unidad tiene referencias en productos o conversiones. Se archivara sin reasignar productos, borrar conversiones ni modificar factores historicos.";
}
