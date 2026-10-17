"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { LocationStatus } from "@/core/enums";
import { isApiMode } from "@/config/api-mode";
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
import type {
  LocationEditorDto,
  LocationListItem,
} from "@/modules/catalog/application/dto/LocationEditorDto";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
} from "@/modules/catalog/components/CatalogIcons";
import { useLocations, type LocationStatusFilter } from "@/modules/catalog/hooks/useLocations";
import {
  buildDefaultLocationDto,
  hasLocationValidationErrors,
  locationToDto,
  validateLocationDto,
  type LocationValidationErrors,
} from "@/modules/catalog/validation/location.validation";

type PanelMode = "detail" | "create" | "edit";
type PanelState = { mode: PanelMode; location?: LocationListItem } | null;

export function LocationsPage() {
  const { showToast } = useToast();
  const {
    loading,
    busy,
    error,
    canRead,
    canManage,
    currentBranchId,
    locations,
    filteredLocations,
    paginatedLocations,
    search,
    status,
    page,
    pageSize,
    totalPages,
    setSearch,
    setStatus,
    setPage,
    setPageSize,
    create,
    update,
    archive,
    restore,
  } = useLocations();
  const [panel, setPanel] = useState<PanelState>(null);
  const [archiveTarget, setArchiveTarget] = useState<LocationListItem | null>(null);
  const selectedLocation =
    panel?.location && locations.find((location) => location.id === panel.location?.id);
  const panelLocation = selectedLocation ?? panel?.location;
  const firstVisible = filteredLocations.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min(page * pageSize, filteredLocations.length);

  async function handleCreate(dto: LocationEditorDto) {
    const created = await create(dto);
    if (created) setPanel({ mode: "detail", location: created });
    showToast({ title: "Ubicacion creada", tone: "success" });
  }

  async function handleUpdate(dto: LocationEditorDto) {
    if (!panelLocation) return;
    try {
      const updated = await update(panelLocation.id, dto);
      if (updated) setPanel({ mode: "detail", location: updated });
      showToast({ title: "Ubicacion actualizada", tone: "success" });
    } catch (error) {
      showToast({
        title: "No se pudo actualizar la ubicacion",
        description: error instanceof Error ? error.message : undefined,
        tone: "danger",
      });
    }
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    try {
      await archive(archiveTarget.id);
      showToast({ title: "Ubicacion archivada", tone: "success" });
      if (panelLocation?.id === archiveTarget.id) {
        setPanel({
          mode: "detail",
          location: { ...archiveTarget, status: LocationStatus.archived },
        });
      }
      setArchiveTarget(null);
    } catch (error) {
      showToast({
        title: "No se pudo archivar la ubicacion",
        description: error instanceof Error ? error.message : undefined,
        tone: "danger",
      });
    }
  }

  function requestArchive(location: LocationListItem) {
    if (location.productCount != null && location.productCount > 0) {
      showToast({
        title: "Ubicacion asignada",
        description: "Desasigna los productos antes de archivar la ubicacion.",
        tone: "danger",
      });
      return;
    }
    setArchiveTarget(location);
  }

  async function handleRestore(location: LocationListItem) {
    await restore(location.id);
    showToast({ title: "Ubicacion reactivada", tone: "success" });
    setPanel({ mode: "detail", location: { ...location, status: LocationStatus.active } });
  }

  if (!loading && !canRead) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
        <header className="border-b border-[var(--color-border)] pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            INVENTARIO
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[var(--color-title)]">Ubicaciones</h1>
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
            INVENTARIO
          </p>
          <h1 className="mt-1 break-words text-2xl font-bold text-[var(--color-title)]">
            Ubicaciones
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Define lugares fisicos donde normalmente se almacenan productos.
          </p>
        </div>
        {canManage ? (
          <Button
            className="w-full sm:w-auto"
            disabled={!currentBranchId}
            onClick={() => setPanel({ mode: "create" })}
            type="button"
          >
            <PlusIcon />
            Nueva ubicacion
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
          <LocationFilters
            search={search}
            status={status}
            onSearchChange={setSearch}
            onStatusChange={setStatus}
          />
          {loading ? (
            <p className="border-t border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]">
              Cargando ubicaciones...
            </p>
          ) : (
            <LocationTable
              canManage={canManage}
              emptyMessage={
                locations.length === 0
                  ? "Aun no hay ubicaciones registradas."
                  : "No hay ubicaciones que coincidan con los filtros."
              }
              locations={paginatedLocations}
              onArchive={requestArchive}
              onEdit={(location) => setPanel({ mode: "edit", location })}
              onOpen={(location) => setPanel({ mode: "detail", location })}
              onRestore={handleRestore}
            />
          )}
          {filteredLocations.length > 0 ? (
            <LocationTableFooter
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              page={page}
              pageSize={pageSize}
              totalItems={filteredLocations.length}
              totalPages={totalPages}
            />
          ) : null}
        </div>

        {panel ? (
          <LocationPanel
            busy={busy}
            canManage={canManage}
            currentBranchId={currentBranchId ?? ""}
            location={panelLocation}
            locations={locations}
            mode={panel.mode}
            onCancel={() =>
              panel.mode === "detail"
                ? setPanel(null)
                : setPanel(panelLocation ? { mode: "detail", location: panelLocation } : null)
            }
            onClose={() => setPanel(null)}
            onEdit={() => panelLocation && setPanel({ mode: "edit", location: panelLocation })}
            onSubmit={panel.mode === "create" ? handleCreate : handleUpdate}
          />
        ) : null}
      </section>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archivar ubicacion"
        message="La ubicacion dejara de estar disponible. Esta accion no mueve stock ni elimina historial."
        confirmLabel="Archivar"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
      />
    </div>
  );
}

function LocationFilters({
  search,
  status,
  onSearchChange,
  onStatusChange,
}: {
  search: string;
  status: LocationStatusFilter;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: LocationStatusFilter) => void;
}) {
  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <Input
        aria-label="Buscar ubicaciones"
        maxLength={TEXT_LIMITS.search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Buscar por nombre, codigo o descripcion..."
        type="search"
        value={search}
      />
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <StatusFilterButton
          active={status === LocationStatus.active}
          onClick={() => onStatusChange(LocationStatus.active)}
        >
          Activas
        </StatusFilterButton>
        <StatusFilterButton
          active={status === LocationStatus.inactive}
          onClick={() => onStatusChange(LocationStatus.inactive)}
        >
          Inactivas
        </StatusFilterButton>
        <StatusFilterButton
          active={status === LocationStatus.archived}
          onClick={() => onStatusChange(LocationStatus.archived)}
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

function LocationTable({
  canManage,
  emptyMessage,
  locations,
  onArchive,
  onEdit,
  onOpen,
  onRestore,
}: {
  canManage: boolean;
  emptyMessage: string;
  locations: LocationListItem[];
  onArchive: (location: LocationListItem) => void;
  onEdit: (location: LocationListItem) => void;
  onOpen: (location: LocationListItem) => void;
  onRestore: (location: LocationListItem) => void;
}) {
  return (
    <div className="overflow-x-auto border-t border-[var(--color-border)]">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm lg:min-w-[760px]">
        <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
          <tr>
            <th className="px-4 py-3 font-semibold">Nombre</th>
            <th className="hidden px-4 py-3 font-semibold md:table-cell">Codigo</th>
            <th className="px-4 py-3 text-right font-semibold">Productos asociados</th>
            <th className="w-24 px-4 py-3 text-right font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {locations.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-[var(--color-text-muted)]" colSpan={4}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            locations.map((location) => (
              <tr
                className="cursor-pointer border-t border-[var(--color-border)] transition hover:bg-[var(--color-primary)]/5 focus:bg-[var(--color-primary)]/5 focus:outline focus:outline-2 focus:outline-inset focus:outline-[var(--color-structure)]"
                key={location.id}
                onClick={() => onOpen(location)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(location);
                }}
                tabIndex={0}
              >
                <td className="min-w-[220px] px-4 py-3">
                  <p
                    className="font-semibold text-[var(--color-title)]"
                    style={{ paddingLeft: `${location.depth * 16}px` }}
                  >
                    {location.name}
                  </p>
                  {location.description ? (
                    <p className="mt-1 line-clamp-2 text-xs font-semibold text-[var(--color-text-muted)]">
                      {location.description}
                    </p>
                  ) : null}
                </td>
                <td className="hidden px-4 py-3 font-semibold text-[var(--color-text)] md:table-cell">
                  {location.code}
                </td>
                <td className="px-4 py-3 text-right font-bold text-[var(--color-title)]">
                  {location.productCount ?? "-"}
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <LocationActionsMenu
                      location={location}
                      onArchive={onArchive}
                      onEdit={onEdit}
                      onRestore={onRestore}
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

function LocationActionsMenu({
  location,
  onArchive,
  onEdit,
  onRestore,
}: {
  location: LocationListItem;
  onArchive: (location: LocationListItem) => void;
  onEdit: (location: LocationListItem) => void;
  onRestore: (location: LocationListItem) => void;
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

  function select(action: (location: LocationListItem) => void) {
    setOpen(false);
    action(location);
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
        aria-label={`Acciones de ${location.name}`}
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
          {location.status === LocationStatus.active ? (
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

function LocationTableFooter({
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
          Mostrando {firstVisible}-{lastVisible} de {totalItems} ubicaciones
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
        aria-label="Paginacion de ubicaciones"
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

function LocationPanel({
  busy,
  canManage,
  currentBranchId,
  location,
  locations,
  mode,
  onCancel,
  onClose,
  onEdit,
  onSubmit,
}: {
  busy: boolean;
  canManage: boolean;
  currentBranchId: string;
  location?: LocationListItem;
  locations: LocationListItem[];
  mode: PanelMode;
  onCancel: () => void;
  onClose: () => void;
  onEdit: () => void;
  onSubmit: (dto: LocationEditorDto) => Promise<void>;
}) {
  const isForm = mode !== "detail";

  return (
    <>
      <button
        aria-label="Cerrar panel de ubicacion"
        className="fixed inset-0 z-30 bg-[var(--color-topbar)]/25 lg:hidden"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={mode === "detail" ? "Detalle de ubicacion" : "Formulario de ubicacion"}
        className="fixed inset-x-3 bottom-3 top-3 z-40 flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-xl lg:static lg:z-auto lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              {mode === "detail"
                ? "Detalle de ubicacion"
                : mode === "create"
                  ? "Nueva ubicacion"
                  : "Editar ubicacion"}
            </p>
            <h2 className="mt-1 break-words text-lg font-bold text-[var(--color-title)]">
              {mode === "create" ? "Nueva ubicacion" : (location?.name ?? "Ubicacion")}
            </h2>
          </div>
          <button
            aria-label="Cerrar"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-bold text-[var(--color-title)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isForm ? (
            <LocationForm
              busy={busy}
              currentBranchId={currentBranchId}
              location={location}
              locations={locations}
              mode={mode}
              onCancel={onCancel}
              onSubmit={onSubmit}
            />
          ) : location ? (
            <LocationDetail
              canManage={canManage}
              location={location}
              onClose={onClose}
              onEdit={onEdit}
            />
          ) : null}
        </div>
      </aside>
    </>
  );
}

function LocationDetail({
  canManage,
  location,
  onClose,
  onEdit,
}: {
  canManage: boolean;
  location: LocationListItem;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] bg-white px-4">
        <DetailItem label="Nombre" value={location.name} />
        <DetailItem label="Codigo" value={location.code} />
        <DetailItem label="Tipo" value={LOCATION_TYPE_LABELS[location.type] ?? location.type} />
        {location.parentName ? (
          <DetailItem label="Ubicacion padre" value={location.parentName} />
        ) : null}
        <DetailItem
          label="Productos asociados"
          value={location.productCount == null ? "-" : String(location.productCount)}
        />
        <DetailItem label="Estado" value={<StatusBadge status={location.status} />} />
        <DetailItem label="Descripcion" value={location.description ?? "Sin descripcion"} />
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

function LocationForm({
  busy,
  currentBranchId,
  location,
  locations,
  mode,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  currentBranchId: string;
  location?: LocationListItem;
  locations: LocationListItem[];
  mode: PanelMode;
  onCancel: () => void;
  onSubmit: (dto: LocationEditorDto) => Promise<void>;
}) {
  const [value, setValue] = useState<LocationEditorDto>(() =>
    location ? locationToDto(location) : buildDefaultLocationDto(currentBranchId),
  );
  const [errors, setErrors] = useState<LocationValidationErrors>({});
  const parentOptions = useMemo(
    () =>
      locations.filter(
        (candidate) =>
          candidate.id !== location?.id &&
          candidate.branchId === (location?.branchId ?? currentBranchId) &&
          candidate.status === LocationStatus.active &&
          isSelectableParent(value.type, candidate.type),
      ),
    [currentBranchId, location?.branchId, location?.id, locations, value.type],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValue = {
      ...value,
      branchId: location?.branchId ?? currentBranchId,
      parentId: value.parentId,
    };
    const nextErrors = validateLocationDto(nextValue, locations, location?.id);
    setErrors(nextErrors);
    if (hasLocationValidationErrors(nextErrors)) return;
    await onSubmit(nextValue);
  }

  function update(patch: Partial<LocationEditorDto>) {
    const nextValue = { ...value, ...patch };
    setValue(nextValue);
    setErrors((currentErrors) => {
      const validation = validateLocationDto(
        {
          ...nextValue,
          branchId: location?.branchId ?? currentBranchId,
          parentId: nextValue.parentId,
        },
        locations,
        location?.id,
      );
      const nextErrors = { ...currentErrors };
      for (const field of Object.keys(patch) as Array<keyof LocationValidationErrors>) {
        if (!currentErrors[field]) continue;
        if (validation[field]) nextErrors[field] = validation[field];
        else delete nextErrors[field];
      }
      return nextErrors;
    });
  }

  return (
    <form className="space-y-4" id="catalog-location-form" noValidate onSubmit={submit}>
      <Field id="location-name" label="Nombre *" error={errors.name}>
        <Input
          id="location-name"
          maxLength={TEXT_LIMITS.locationName}
          onChange={(event) => update({ name: event.target.value })}
          value={value.name}
        />
      </Field>
      <Field id="location-code" label="Codigo" error={errors.code}>
        <Input
          disabled={mode === "edit"}
          id="location-code"
          maxLength={TEXT_LIMITS.locationCode}
          onChange={(event) => update({ code: event.target.value })}
          placeholder="BOD-CENTRO"
          value={value.code}
        />
      </Field>
      {isApiMode() ? (
        <>
          <Field id="location-type" label="Tipo" error={errors.type}>
            <Select
              disabled={mode === "edit"}
              id="location-type"
              onChange={(event) =>
                update({ type: event.target.value as LocationEditorDto["type"], parentId: "" })
              }
              value={value.type}
            >
              <option value="warehouse">Bodega</option>
              <option value="aisle">Pasillo</option>
              <option value="shelf">Estante</option>
              <option value="level">Nivel</option>
            </Select>
          </Field>
          {value.type !== "warehouse" ? (
            <Field id="location-parent" label="Ubicacion padre *" error={errors.parentId}>
              <Select
                disabled={mode === "edit"}
                id="location-parent"
                onChange={(event) => update({ parentId: event.target.value })}
                value={value.parentId}
              >
                <option value="">Selecciona una ubicacion</option>
                {parentOptions.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.name} ({LOCATION_TYPE_LABELS[parent.type] ?? parent.type})
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </>
      ) : null}
      {!isApiMode() ? (
        <Field id="location-description" label="Descripcion" error={errors.description}>
          <textarea
            className="min-h-24 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
            id="location-description"
            maxLength={500}
            onChange={(event) => update({ description: event.target.value })}
            value={value.description}
          />
          <p className="text-right text-xs text-[var(--color-text-muted)]">
            {value.description.length} / 500
          </p>
        </Field>
      ) : null}
      <Field id="location-status" label="Estado" error={errors.status}>
        <Select
          id="location-status"
          onChange={(event) => update({ status: event.target.value as LocationStatus })}
          value={value.status}
        >
          <option value={LocationStatus.active}>Activa</option>
          <option value={LocationStatus.inactive}>Inactiva</option>
          <option value={LocationStatus.archived}>Archivada</option>
        </Select>
      </Field>
      <footer className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
        <Button className="w-full sm:w-auto" onClick={onCancel} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button className="w-full sm:w-auto" disabled={busy} type="submit">
          <CheckIcon />
          {busy ? "Guardando..." : mode === "create" ? "Guardar ubicacion" : "Guardar cambios"}
        </Button>
      </footer>
    </form>
  );
}

const LOCATION_TYPE_LABELS: Partial<Record<LocationListItem["type"], string>> = {
  warehouse: "Bodega",
  aisle: "Pasillo",
  shelf: "Estante",
  level: "Nivel",
};

function isSelectableParent(
  childType: LocationEditorDto["type"],
  parentType: LocationListItem["type"],
) {
  if (childType === "aisle") return parentType === "warehouse";
  if (childType === "shelf") return parentType === "warehouse" || parentType === "aisle";
  if (childType === "level") return parentType === "shelf";
  return false;
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
