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
import { useRouter } from "next/navigation";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { processImageUpload } from "@/shared/application/services/processImageUpload";
import { CatalogImage } from "@/modules/catalog/components/CatalogImage";
import { CategoryStatus } from "@/core/enums";
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
  CategoryEditorDto,
  CategoryListItem,
} from "@/modules/catalog/application/dto/CategoryEditorDto";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
} from "@/modules/catalog/components/CatalogIcons";
import { useCategories } from "@/modules/catalog/hooks/useCategories";
import { CategoryImagePartialSaveError } from "@/modules/catalog/application/services/CategoryImagePartialSaveError";
import type { CategoryStatusFilter } from "@/modules/catalog/hooks/useCategories";
import {
  buildDefaultCategoryDto,
  categoryToDto,
  hasCategoryValidationErrors,
  validateCategoryDto,
  type CategoryValidationErrors,
} from "@/modules/catalog/validation/category.validation";

type PanelMode = "detail" | "create" | "edit";
type PanelState = {
  mode: PanelMode;
  category?: CategoryListItem;
  categoryId?: string;
} | null;

export function CategoriesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    loading,
    busy,
    error,
    canRead,
    canManage,
    categories,
    filteredCategories,
    paginatedCategories,
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
  } = useCategories();
  const [panel, setPanel] = useState<PanelState>(null);
  const [archiveTarget, setArchiveTarget] = useState<CategoryListItem | null>(null);
  const selectedCategoryId = panel?.categoryId ?? panel?.category?.id;
  const selectedCategory = selectedCategoryId
    ? categories.find((category) => category.id === selectedCategoryId)
    : undefined;
  const panelCategory = selectedCategory ?? panel?.category;
  const firstVisible = filteredCategories.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min(page * pageSize, filteredCategories.length);

  async function handleCreate(dto: CategoryEditorDto) {
    try {
      const created = await create(dto);
      if (created) setPanel({ mode: "detail", category: created });
      showToast({ title: "Categoría creada", tone: "success" });
    } catch (error) {
      if (!(error instanceof CategoryImagePartialSaveError)) throw error;
      setPanel({ mode: "edit", categoryId: error.categoryId });
      showToast({
        title: "Categoría guardada parcialmente",
        description: error.message,
        tone: "warning",
        duration: 8000,
      });
    }
  }

  async function handleUpdate(dto: CategoryEditorDto) {
    if (!panelCategory) return;
    try {
      const updated = await update(panelCategory.id, dto);
      if (updated) setPanel({ mode: "detail", category: updated });
      showToast({ title: "Categoría actualizada", tone: "success" });
    } catch (error) {
      if (!(error instanceof CategoryImagePartialSaveError)) throw error;
      setPanel({ mode: "edit", categoryId: error.categoryId });
      showToast({
        title: "Categoría guardada parcialmente",
        description: error.message,
        tone: "warning",
        duration: 8000,
      });
    }
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    await archive(archiveTarget.id);
    showToast({ title: "Categoría archivada", tone: "success" });
    if (panelCategory?.id === archiveTarget.id) {
      setPanel({
        mode: "detail",
        category: { ...archiveTarget, status: CategoryStatus.archived },
      });
    }
    setArchiveTarget(null);
  }

  async function handleRestore(category: CategoryListItem) {
    await restore(category.id);
    showToast({ title: "Categoría restaurada", tone: "success" });
    setPanel({ mode: "detail", category: { ...category, status: CategoryStatus.active } });
  }

  if (!loading && !canRead) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
        <header className="border-b border-[var(--color-border)] pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            CATEGORÍA
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[var(--color-title)]">Categorías</h1>
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
            CATEGORÍA
          </p>
          <h1 className="mt-1 break-words text-2xl font-bold text-[var(--color-title)]">
            Categorías
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Define la estructura que después usarás al registrar y organizar productos.
          </p>
        </div>
        {canManage ? (
          <Button
            className="w-full sm:w-auto"
            onClick={() => setPanel({ mode: "create" })}
            type="button"
          >
            <PlusIcon />
            Nueva categoría
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
          <CategoryFilters
            search={search}
            status={status}
            onSearchChange={setSearch}
            onStatusChange={setStatus}
          />
          {loading ? (
            <p className="border-t border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]">
              Cargando categorías...
            </p>
          ) : (
            <CategoryTable
              canManage={canManage}
              categories={paginatedCategories}
              emptyMessage={
                categories.length === 0
                  ? "Aún no hay categorías registradas."
                  : "No hay categorías que coincidan con los filtros."
              }
              onArchive={setArchiveTarget}
              onEdit={(category) => setPanel({ mode: "edit", category })}
              onOpen={(category) => setPanel({ mode: "detail", category })}
              onRestore={handleRestore}
            />
          )}
          {filteredCategories.length > 0 ? (
            <CategoryTableFooter
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              page={page}
              pageSize={pageSize}
              totalItems={filteredCategories.length}
              totalPages={totalPages}
            />
          ) : null}
        </div>

        {panel && (panel.mode === "create" || panelCategory) ? (
          <CategoryPanel
            allCategories={categories}
            busy={busy}
            canManage={canManage}
            category={panelCategory}
            mode={panel.mode}
            onCancel={() =>
              panel.mode === "detail"
                ? setPanel(null)
                : setPanel(panelCategory ? { mode: "detail", category: panelCategory } : null)
            }
            onClose={() => setPanel(null)}
            onEdit={() => panelCategory && setPanel({ mode: "edit", category: panelCategory })}
            onSubmit={panel.mode === "create" ? handleCreate : handleUpdate}
            onViewProducts={(category) =>
              router.push(`/catalogo/productos?categoryId=${category.id}`)
            }
          />
        ) : null}
      </section>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archivar categoría"
        message="La categoría dejará de estar disponible para organizar nuevos productos, pero se conservará su historial."
        confirmLabel="Archivar"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
      />
    </div>
  );
}

function CategoryFilters({
  search,
  status,
  onSearchChange,
  onStatusChange,
}: {
  search: string;
  status: CategoryStatusFilter;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: CategoryStatusFilter) => void;
}) {
  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <Input
        aria-label="Buscar categorías"
        maxLength={TEXT_LIMITS.search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Buscar por nombre, código o categoría padre..."
        type="search"
        value={search}
      />
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <StatusFilterButton
          active={status === CategoryStatus.active}
          onClick={() => onStatusChange(CategoryStatus.active)}
        >
          Activas
        </StatusFilterButton>
        <StatusFilterButton
          active={status === CategoryStatus.archived}
          onClick={() => onStatusChange(CategoryStatus.archived)}
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

function CategoryTable({
  canManage,
  categories,
  emptyMessage,
  onArchive,
  onEdit,
  onOpen,
  onRestore,
}: {
  canManage: boolean;
  categories: CategoryListItem[];
  emptyMessage: string;
  onArchive: (category: CategoryListItem) => void;
  onEdit: (category: CategoryListItem) => void;
  onOpen: (category: CategoryListItem) => void;
  onRestore: (category: CategoryListItem) => void;
}) {
  return (
    <div className="overflow-x-auto border-t border-[var(--color-border)]">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm lg:min-w-[720px]">
        <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
          <tr>
            <th className="px-4 py-3 font-semibold">Categoría</th>
            <th className="hidden px-4 py-3 font-semibold md:table-cell">Descripción</th>
            <th className="px-4 py-3 text-right font-semibold">Cantidad de productos</th>
            <th className="w-24 px-4 py-3 text-right font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {categories.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-[var(--color-text-muted)]" colSpan={4}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            categories.map((category) => (
              <tr
                className="cursor-pointer border-t border-[var(--color-border)] transition hover:bg-[var(--color-primary)]/5 focus:bg-[var(--color-primary)]/5 focus:outline focus:outline-2 focus:outline-inset focus:outline-[var(--color-structure)]"
                key={category.id}
                onClick={() => onOpen(category)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(category);
                }}
                tabIndex={0}
              >
                <td className="min-w-[220px] px-4 py-3">
                  <p
                    className="font-semibold text-[var(--color-title)]"
                    style={{ paddingLeft: `${category.depth * 16}px` }}
                  >
                    {category.name}
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                    {category.code}
                  </p>
                </td>
                <td className="hidden max-w-[320px] px-4 py-3 text-[var(--color-text)] md:table-cell">
                  <span className="line-clamp-2">
                    {category.description ?? category.parentName ?? "Sin descripción"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-bold text-[var(--color-title)]">
                  {category.productCount}
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <CategoryActionsMenu
                      category={category}
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

function CategoryActionsMenu({
  category,
  onArchive,
  onEdit,
  onRestore,
}: {
  category: CategoryListItem;
  onArchive: (category: CategoryListItem) => void;
  onEdit: (category: CategoryListItem) => void;
  onRestore: (category: CategoryListItem) => void;
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
      setMenuStyle({
        right: Math.max(12, window.innerWidth - rect.right),
        top: Math.min(rect.bottom + 6, window.innerHeight - 56),
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

  function select(action: (category: CategoryListItem) => void) {
    setOpen(false);
    action(category);
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
        aria-label={`Acciones de ${category.name}`}
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
          {category.status === CategoryStatus.active ? (
            <MenuItem destructive icon={<ArchiveIcon />} onClick={() => select(onArchive)}>
              Archivar
            </MenuItem>
          ) : (
            <MenuItem icon={<CheckIcon />} onClick={() => select(onRestore)}>
              Restaurar
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

function CategoryTableFooter({
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
          Mostrando {firstVisible}-{lastVisible} de {totalItems} categorías
        </p>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          Filas
          <Select
            aria-label="Filas por página"
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
        aria-label="Paginación de categorías"
        className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start"
      >
        <Button
          aria-label="Página anterior"
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
          aria-label="Página siguiente"
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

function CategoryPanel({
  allCategories,
  busy,
  canManage,
  category,
  mode,
  onCancel,
  onClose,
  onEdit,
  onSubmit,
  onViewProducts,
}: {
  allCategories: CategoryListItem[];
  busy: boolean;
  canManage: boolean;
  category?: CategoryListItem;
  mode: PanelMode;
  onCancel: () => void;
  onClose: () => void;
  onEdit: () => void;
  onSubmit: (dto: CategoryEditorDto) => Promise<void>;
  onViewProducts: (category: CategoryListItem) => void;
}) {
  const isForm = mode !== "detail";

  return (
    <>
      <button
        aria-label="Cerrar panel de categoría"
        className="fixed inset-0 z-30 bg-[var(--color-topbar)]/25 lg:hidden"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={mode === "detail" ? "Detalle de categoría" : "Formulario de categoría"}
        className="fixed inset-x-3 bottom-3 top-3 z-40 flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-xl lg:static lg:z-auto lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              {mode === "detail"
                ? "Detalle de categoría"
                : mode === "create"
                  ? "Nueva categoría"
                  : "Editar categoría"}
            </p>
            <h2 className="mt-1 break-words text-lg font-bold text-[var(--color-title)]">
              {mode === "create" ? "Nueva categoría" : (category?.name ?? "Categoría")}
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
            <CategoryForm
              allCategories={allCategories}
              busy={busy}
              category={category}
              mode={mode}
              onCancel={onCancel}
              onSubmit={onSubmit}
            />
          ) : category ? (
            <CategoryDetail
              canManage={canManage}
              category={category}
              onClose={onClose}
              onEdit={onEdit}
              onViewProducts={() => onViewProducts(category)}
            />
          ) : null}
        </div>
      </aside>
    </>
  );
}

function CategoryDetail({
  canManage,
  category,
  onClose,
  onEdit,
  onViewProducts,
}: {
  canManage: boolean;
  category: CategoryListItem;
  onClose: () => void;
  onEdit: () => void;
  onViewProducts: () => void;
}) {
  return (
    <div className="space-y-4">
      <CategoryImagePreview category={category} />
      <dl className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] bg-white px-4">
        <DetailItem label="Nombre" value={category.name} />
        <DetailItem label="Código" value={category.code} />
        <DetailItem label="Estado" value={<StatusBadge status={category.status} />} />
        <DetailItem label="Cantidad de productos" value={String(category.productCount)} />
        <DetailItem label="Descripción" value={category.description ?? "Sin descripción"} />
        {category.parentName ? (
          <DetailItem label="Categoría padre" value={category.parentName} />
        ) : null}
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button className="w-full sm:w-auto" onClick={onClose} type="button" variant="secondary">
          Cerrar
        </Button>
        <Button
          className="w-full sm:w-auto"
          onClick={onViewProducts}
          type="button"
          variant="secondary"
        >
          Ver productos
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

function CategoryImagePreview({
  category,
  dto,
}: {
  category?: CategoryListItem;
  dto?: CategoryEditorDto;
}) {
  const { user } = useCurrentSession();
  const source = dto?.removeImage ? undefined : (dto?.image ?? category?.image);
  if (!dto?.pendingImage && !source) {
    return (
      <div className="grid h-28 place-items-center rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] text-sm text-[var(--color-text-muted)]">
        Sin imagen
      </div>
    );
  }
  return (
    <CatalogImage
      alt={category?.name ?? dto?.name ?? "Vista previa de categoria"}
      className="h-32 w-full rounded-md border border-[var(--color-border)] bg-white object-cover"
      previewBlob={dto?.pendingImage?.blob}
      source={source}
      tenantId={user?.tenantId ?? category?.tenantId}
    />
  );
}

function CategoryForm({
  allCategories,
  busy,
  category,
  mode,
  onCancel,
  onSubmit,
}: {
  allCategories: CategoryListItem[];
  busy: boolean;
  category?: CategoryListItem;
  mode: PanelMode;
  onCancel: () => void;
  onSubmit: (dto: CategoryEditorDto) => Promise<void>;
}) {
  const [value, setValue] = useState<CategoryEditorDto>(() =>
    category ? categoryToDto(category) : buildDefaultCategoryDto(),
  );
  const [errors, setErrors] = useState<CategoryValidationErrors>({});
  const [imageError, setImageError] = useState<string | null>(null);
  const parentOptions = useMemo(
    () => allCategories.filter((item) => item.id !== category?.id),
    [allCategories, category?.id],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateCategoryDto(value, allCategories, category?.id);
    setErrors(nextErrors);
    if (hasCategoryValidationErrors(nextErrors)) return;
    await onSubmit(value);
  }

  function update(patch: Partial<CategoryEditorDto>) {
    const nextValue = { ...value, ...patch };
    setValue(nextValue);
    setErrors((currentErrors) => {
      const validation = validateCategoryDto(nextValue, allCategories, category?.id);
      const nextErrors = { ...currentErrors };
      for (const field of Object.keys(patch) as Array<keyof CategoryValidationErrors>) {
        if (!currentErrors[field]) continue;
        if (validation[field]) nextErrors[field] = validation[field];
        else delete nextErrors[field];
      }
      return nextErrors;
    });
  }

  async function selectImage(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    try {
      update({ pendingImage: await processImageUpload(file), removeImage: false });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "No se pudo procesar la imagen.");
    }
  }

  return (
    <form className="space-y-4" id="catalog-category-form" noValidate onSubmit={submit}>
      <Field id="category-name" label="Nombre *" error={errors.name}>
        <Input
          id="category-name"
          maxLength={TEXT_LIMITS.categoryName}
          onChange={(event) => update({ name: event.target.value })}
          value={value.name}
        />
      </Field>
      <Field id="category-code" label="Código interno *" error={errors.code}>
        <Input
          id="category-code"
          maxLength={TEXT_LIMITS.categoryCode}
          onChange={(event) => update({ code: event.target.value })}
          placeholder="HERR"
          value={value.code}
        />
      </Field>
      <Field id="category-description" label="Descripción" error={errors.description}>
        <textarea
          className="min-h-24 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
          id="category-description"
          maxLength={500}
          onChange={(event) => update({ description: event.target.value })}
          value={value.description}
        />
        <p className="text-right text-xs text-[var(--color-text-muted)]">
          {value.description.length} / 500
        </p>
      </Field>
      <Field id="category-image" label="Imagen">
        <CategoryImagePreview dto={value} />
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white">
            {value.image || value.pendingImage ? "Reemplazar imagen" : "Seleccionar imagen"}
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="category-image"
              onChange={(event) => {
                void selectImage(event.target.files?.[0]);
                event.target.value = "";
              }}
              type="file"
            />
          </label>
          {value.image || value.pendingImage ? (
            <Button
              onClick={() =>
                update({ image: undefined, pendingImage: undefined, removeImage: true })
              }
              type="button"
              variant="danger"
            >
              Eliminar imagen
            </Button>
          ) : null}
        </div>
        {imageError ? (
          <p className="mt-2 text-sm text-[var(--color-danger)]">{imageError}</p>
        ) : null}
      </Field>
      <Field id="category-status" label="Estado">
        <Select
          id="category-status"
          onChange={(event) => update({ status: event.target.value as CategoryStatus })}
          value={value.status}
        >
          <option value={CategoryStatus.active}>Activa</option>
          <option value={CategoryStatus.archived}>Archivada</option>
        </Select>
      </Field>
      <Field id="category-parent" label="Categoría padre" error={errors.parentId}>
        <Select
          id="category-parent"
          onChange={(event) => update({ parentId: event.target.value })}
          value={value.parentId}
        >
          <option value="">Sin categoría padre</option>
          {parentOptions.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </Select>
      </Field>
      <footer className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
        <Button className="w-full sm:w-auto" onClick={onCancel} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button className="w-full sm:w-auto" disabled={busy} type="submit">
          <CheckIcon />
          {busy ? "Guardando..." : mode === "create" ? "Guardar categoría" : "Guardar cambios"}
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
