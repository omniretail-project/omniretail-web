"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import type {
  OperationalSupplierIncident,
  OperationalSupplierIncidentPageParams,
  OperationalSupplierProduct,
  OperationalSupplierProductPageParams,
} from "@/core/repositories";
import type { PaginatedResult } from "@/core/types";
import { RECEIPT_INCIDENT_TYPE_LABELS } from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import type { ReceiptIncidentEvidence } from "@/core/entities";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { TablePagination, type TablePageSize } from "@/shared/components/TablePagination";
import { cn } from "@/shared/utils/cn";
import type {
  SupplierIncidentReadModel,
  SupplierListItemReadModel,
  SupplierPurchaseOrderReadModel,
  SupplierStatusFilter,
} from "@/modules/purchasing/application/dto/SupplierReadModel";
import { PurchaseOrderStatusBadge } from "@/modules/purchasing/components/PurchaseOrderStatusBadge";
import { saveOrdersNavContext } from "@/modules/purchasing/application/services/purchaseOrdersNavContext";
import { useSuppliers } from "@/modules/purchasing/hooks/useSuppliers";
import { IncidentDetailContent } from "@/modules/receiving/components/IncidentDetail";

type SupplierDetailTab = "general" | "contacts" | "products" | "purchases" | "incidents";
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const DETAIL_TABS: Array<{ id: SupplierDetailTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "contacts", label: "Contactos" },
  { id: "products", label: "Productos y costos" },
  { id: "purchases", label: "Compras" },
  { id: "incidents", label: "Incidencias" },
];

export function SuppliersPage() {
  const {
    apiMode,
    rows,
    hasSuppliers,
    filters,
    page,
    pageSize,
    totalItems,
    totalPages,
    loading,
    error,
    updateFilters,
    setPage,
    setPageSize,
    loadSupplierDetail,
    loadSupplierOrders,
    loadSupplierProducts,
    loadSupplierIncidents,
  } = useSuppliers();
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [previewEvidence, setPreviewEvidence] = useState<ReceiptIncidentEvidence | null>(null);
  const selectedSupplier = rows.find((supplier) => supplier.id === selectedSupplierId) ?? null;
  const emptyMessage = hasSuppliers
    ? "No se encontraron proveedores."
    : "No hay proveedores registrados.";

  function handleSearchChange(search: string) {
    setSelectedSupplierId(null);
    updateFilters({ search });
  }

  function handleStatusChange(status: SupplierStatusFilter) {
    setSelectedSupplierId(null);
    updateFilters({ status });
  }

  function changePage(nextPage: number) {
    setSelectedSupplierId(null);
    setPage(Math.min(Math.max(nextPage, 1), totalPages));
  }

  function handlePageSizeChange(nextPageSize: TablePageSize) {
    setPageSize(nextPageSize);
    setSelectedSupplierId(null);
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Compras
        </p>
        <PageHeader
          title="Proveedores"
          description="Consulta proveedores, contactos, costos asociados e historial operativo."
        />
      </div>

      {error ? <InlineAlert title={error} tone="danger" /> : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <Input
            aria-label="Buscar proveedores"
            maxLength={TEXT_LIMITS.search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Buscar por nombre, razon social, NIT, contacto, telefono o correo..."
            type="search"
            value={filters.search}
          />
          <StatusSegmentedFilter value={filters.status} onChange={handleStatusChange} />
        </div>
      </section>

      <section
        className={cn(
          "grid min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm",
          selectedSupplier
            ? "gap-0 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,min(44%,36rem))]"
            : "xl:grid-cols-1",
        )}
      >
        <div className="min-w-0 overflow-hidden">
          {loading ? (
            <p className="p-5 text-sm text-[var(--color-text-muted)]">Cargando proveedores...</p>
          ) : (
            <>
              <SuppliersTable
                apiMode={apiMode}
                compact={Boolean(selectedSupplier)}
                emptyMessage={emptyMessage}
                selectedSupplierId={selectedSupplierId}
                suppliers={rows}
                onSelect={setSelectedSupplierId}
              />
              <TablePagination
                ariaLabel="Paginacion de proveedores"
                itemLabel="proveedores"
                page={page}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={changePage}
                onPageSizeChange={handlePageSizeChange}
              />
            </>
          )}
        </div>

        {selectedSupplier ? (
          <SupplierDetailPanel
            key={selectedSupplier.id}
            apiMode={apiMode}
            loadDetail={loadSupplierDetail}
            loadOrders={loadSupplierOrders}
            loadProducts={loadSupplierProducts}
            loadIncidents={loadSupplierIncidents}
            supplier={selectedSupplier}
            onClose={() => setSelectedSupplierId(null)}
            onPreview={setPreviewEvidence}
          />
        ) : null}
      </section>
      <Modal
        open={Boolean(previewEvidence)}
        title={previewEvidence?.name ?? "Evidencia"}
        onClose={() => setPreviewEvidence(null)}
        size="xl"
      >
        {previewEvidence?.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={previewEvidence.name}
            className="mx-auto max-h-[72dvh] max-w-full object-contain"
            src={previewEvidence.previewUrl}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function SuppliersTable({
  apiMode,
  compact,
  suppliers,
  selectedSupplierId,
  emptyMessage,
  onSelect,
}: {
  apiMode: boolean;
  /** Con un proveedor abierto la tabla cede ancho al panel: solo Proveedor, NIT y Estado. */
  compact: boolean;
  suppliers: SupplierListItemReadModel[];
  selectedSupplierId: string | null;
  emptyMessage: string;
  onSelect: (supplierId: string) => void;
}) {
  return (
    <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <table
        className={cn(
          "w-full table-fixed border-collapse text-left text-sm",
          !compact && "min-w-[760px]",
        )}
      >
        <colgroup>
          {compact ? (
            <>
              <col className="w-[50%]" />
              <col className="w-[28%]" />
              <col className="w-[22%]" />
            </>
          ) : (
            <>
              <col className="w-[31%]" />
              <col className="w-[14%]" />
              <col className="w-[25%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
            </>
          )}
        </colgroup>
        <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
          <tr>
            <th className="px-3 py-3 font-semibold">Proveedor</th>
            <th className="px-3 py-3 font-semibold">NIT</th>
            {compact ? (
              <th className="px-3 py-3 font-semibold">Estado</th>
            ) : (
              <>
                <th className="px-3 py-3 font-semibold">Contacto</th>
                <th className="px-3 py-3 font-semibold">{apiMode ? "Estado" : "Condicion"}</th>
                <th className="px-3 py-3 font-semibold">Entrega</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {suppliers.length === 0 ? (
            <tr>
              <td className="px-4 py-10 text-center text-[var(--color-text-muted)]" colSpan={compact ? 3 : 5}>
                <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                  <BuildingIcon className="h-6 w-6 text-[var(--color-structure)]" />
                  <p className="font-bold text-[var(--color-title)]">{emptyMessage}</p>
                </div>
              </td>
            </tr>
          ) : (
            suppliers.map((supplier) => {
              const contact = supplier.contacts[0];
              return (
                <tr
                  className={cn(
                    "cursor-pointer border-t border-[var(--color-border)] transition hover:bg-[var(--color-primary)]/5 focus-visible:bg-[var(--color-primary)]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-structure)]",
                    selectedSupplierId === supplier.id &&
                      "border-l-4 border-l-[var(--color-structure)] bg-[var(--color-primary)]/10",
                  )}
                  key={supplier.id}
                  onClick={() => onSelect(supplier.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onSelect(supplier.id);
                  }}
                  tabIndex={0}
                >
                  <td className="px-3 py-3">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-[var(--color-title)]" title={supplier.name}>
                          {supplier.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]" title={supplier.legalName ?? "Sin razon social"}>
                          {supplier.legalName ?? "Sin razon social"}
                        </p>
                      </div>
                      {supplier.archived ? <StatusBadge status={supplier.status} /> : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-medium text-[var(--color-text)]">
                    {supplier.taxId ?? "-"}
                  </td>
                  {compact ? (
                    <td className="px-3 py-3">
                      <StatusBadge status={supplier.status} />
                    </td>
                  ) : (
                    <>
                  <td className="px-3 py-3">
                    {apiMode ? (
                      <>
                        <p className="truncate font-medium text-[var(--color-title)]" title={supplier.email ?? "No definido"}>
                          {supplier.email ?? "No definido"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]" title={supplier.phone ?? "No definido"}>
                          {supplier.phone ?? "No definido"}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="truncate font-medium text-[var(--color-title)]" title={contact?.name ?? "Sin contacto"}>
                          {contact?.name ?? "Sin contacto"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]" title={formatContactLine(contact?.phone, contact?.email)}>
                          {formatContactLine(contact?.phone, contact?.email)}
                        </p>
                      </>
                    )}
                  </td>
                  <td className="break-words px-3 py-3 leading-tight text-[var(--color-text)]">
                    {apiMode ? <StatusBadge status={supplier.status} /> : supplier.paymentConditionLabel}
                  </td>
                  <td className="break-words px-3 py-3 leading-tight text-[var(--color-text)]">{formatDeliveryLabel(supplier.deliveryLabel)}</td>
                    </>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusSegmentedFilter({
  value,
  onChange,
}: {
  value: SupplierStatusFilter;
  onChange: (value: SupplierStatusFilter) => void;
}) {
  const options: Array<{ value: SupplierStatusFilter; label: string }> = [
    { value: "active", label: "Activos" },
    { value: "archived", label: "Archivados" },
  ];

  return (
    <div aria-label="Estado de proveedor" className="flex h-10 items-center gap-2" role="group">
      {options.map((option) => (
        <button
          className={cn(
            "h-9 rounded-md border px-3 text-sm font-semibold transition",
            value === option.value
              ? "border-blue-200 bg-blue-100 text-[var(--color-title)] shadow-sm"
              : "border-[var(--color-border)] bg-white text-[var(--color-title)] hover:bg-[var(--color-app-background)]",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type DetailState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; detail: SupplierListItemReadModel };

function SupplierDetailPanel({
  apiMode,
  loadDetail,
  loadOrders,
  loadProducts,
  loadIncidents,
  supplier: listSupplier,
  onClose,
  onPreview,
}: {
  apiMode: boolean;
  loadDetail: (supplierId: string) => Promise<SupplierListItemReadModel>;
  loadOrders: (supplierId: string) => Promise<SupplierPurchaseOrderReadModel[]>;
  loadProducts: (
    supplierId: string,
    params: OperationalSupplierProductPageParams,
  ) => Promise<PaginatedResult<OperationalSupplierProduct>>;
  loadIncidents: (
    supplierId: string,
    params: Omit<OperationalSupplierIncidentPageParams, "branchId">,
  ) => Promise<PaginatedResult<OperationalSupplierIncident>>;
  supplier: SupplierListItemReadModel;
  onClose: () => void;
  onPreview: (evidence: ReceiptIncidentEvidence) => void;
}) {
  const [activeTab, setActiveTab] = useState<SupplierDetailTab>("general");
  const [detailState, setDetailState] = useState<DetailState>({ status: "loading" });
  const listSupplierId = listSupplier.id;

  // API: el detalle se pide una sola vez al abrir el panel (keyed por proveedor).
  useEffect(() => {
    if (!apiMode) return;
    let active = true;
    loadDetail(listSupplierId)
      .then((detail) => {
        if (active) setDetailState({ status: "success", detail });
      })
      .catch(() => {
        if (active) setDetailState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [apiMode, listSupplierId, loadDetail]);

  const supplier =
    apiMode && detailState.status === "success" ? detailState.detail : listSupplier;
  const tabs = DETAIL_TABS;
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const selectedIncident =
    supplier.incidents.find((incident) => incident.id === selectedIncidentId) ?? null;
  const counts: Record<SupplierDetailTab, number | null> = {
    general: null,
    contacts: apiMode ? null : supplier.contacts.length,
    products: apiMode ? null : supplier.products.length,
    purchases: apiMode ? null : supplier.purchaseOrders.length,
    incidents: apiMode ? null : supplier.incidents.length,
  };

  return (
    <aside className="min-w-0 overflow-hidden border-t border-[var(--color-border)] bg-white xl:border-l xl:border-t-0">
      <header className="flex min-h-[3.75rem] items-center justify-between gap-3 bg-[var(--color-structure)] px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/12">
            {selectedIncident ? (
              <AlertIcon className="h-5 w-5" />
            ) : (
              <BuildingIcon className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold">
              {selectedIncident ? "Detalle de incidencia" : "Detalle de proveedor"}
            </p>
            <p className="truncate text-xs font-medium text-blue-50/85">
              {selectedIncident ? selectedIncident.productName : supplier.name}
            </p>
          </div>
        </div>
        <button
          aria-label="Cerrar detalle"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/25 text-lg font-bold text-white transition hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          onClick={onClose}
          type="button"
        >
          x
        </button>
      </header>

      {selectedIncident ? (
        <div className="border-b border-[var(--color-border)] bg-white p-2">
          <button
            className="inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-bold text-[var(--color-title)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
            onClick={() => setSelectedIncidentId(null)}
            type="button"
          >
            <BackIcon /> Volver a incidencias
          </button>
        </div>
      ) : (
        <div
          className="grid grid-cols-[repeat(5,minmax(5.5rem,1fr))] gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-[var(--color-border)] bg-white p-2"
          role="tablist"
        >
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={cn(
                "flex min-h-10 items-center justify-center rounded-md border px-2 py-1.5 text-center text-xs font-semibold leading-tight transition",
                activeTab === tab.id
                  ? "border-blue-200 bg-blue-100 text-[var(--color-title)]"
                  : "border-[var(--color-border)] bg-white text-[var(--color-title)] hover:bg-[var(--color-app-background)]",
              )}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
              {counts[tab.id] === null ? null : ` (${counts[tab.id]})`}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[70vh] overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden p-4 xl:max-h-[calc(100vh-18rem)]">
        {selectedIncident ? (
          <IncidentDetailContent incident={selectedIncident} onPreview={onPreview} />
        ) : (
          <>
            {apiMode && (activeTab === "general" || activeTab === "contacts") && detailState.status === "loading" ? (
              <p className="text-sm font-semibold text-[var(--color-text-muted)]">
                Cargando detalle del proveedor...
              </p>
            ) : null}
            {apiMode && (activeTab === "general" || activeTab === "contacts") && detailState.status === "error" ? (
              <InlineAlert title="No se pudo cargar el detalle del proveedor." tone="danger" />
            ) : null}
            {!apiMode || ((activeTab === "general" || activeTab === "contacts") && detailState.status === "success") ? (
              <>
                {activeTab === "general" ? <GeneralTab apiMode={apiMode} supplier={supplier} /> : null}
                {activeTab === "contacts" ? (
                  apiMode ? <ApiContactTab supplier={supplier} /> : <ContactsTab supplier={supplier} />
                ) : null}
                {activeTab === "products" && !apiMode ? <ProductsTab supplier={supplier} /> : null}
              </>
            ) : null}
            {apiMode && activeTab === "products" ? (
              <ApiProductsTab loadProducts={loadProducts} supplierId={listSupplierId} />
            ) : null}
            {activeTab === "purchases" ? (
              apiMode ? (
                <ApiPurchasesTab loadOrders={loadOrders} supplier={supplier} />
              ) : (
                <PurchasesTab supplier={supplier} />
              )
            ) : null}
            {activeTab === "incidents" ? (
              apiMode ? (
                <ApiIncidentsTab loadIncidents={loadIncidents} supplierId={listSupplierId} />
              ) : (
                <IncidentsTab supplier={supplier} onSelect={setSelectedIncidentId} />
              )
            ) : null}
          </>
        )}
      </div>

      <footer className="border-t border-[var(--color-border)] p-4">
        <Button
          className="w-full"
          onClick={selectedIncident ? () => setSelectedIncidentId(null) : onClose}
          type="button"
          variant="secondary"
        >
          {selectedIncident ? "Volver a incidencias" : "Cerrar"}
        </Button>
      </footer>
    </aside>
  );
}

function GeneralTab({
  supplier,
  apiMode,
}: {
  supplier: SupplierListItemReadModel;
  apiMode: boolean;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-0 rounded-md bg-white sm:grid-cols-2">
      <DetailItem label="Nombre comercial" value={supplier.name} />
      <DetailItem label="Razon social" value={supplier.legalName ?? "-"} />
      <DetailItem label="NIT" value={supplier.taxId ?? "-"} />
      <DetailItem label="Telefono" value={supplier.phone ?? "-"} />
      <DetailItem label="Correo" value={supplier.email ?? "-"} />
      {apiMode ? (
        <DetailItem label="Estado" value={supplier.archived ? "Archivado" : supplier.status === "inactive" ? "Inactivo" : "Activo"} />
      ) : (
        <>
          <DetailItem label="Condicion de pago" value={supplier.paymentConditionLabel} />
          <DetailItem label="Dias de credito" value={supplier.creditDaysLabel} />
          <DetailItem label="Moneda" value={supplier.currencyLabel} />
        </>
      )}
      <DetailItem label="Entrega estimada" value={formatDeliveryLabel(supplier.deliveryLabel)} wide={apiMode} />
      <DetailItem label="Direccion" value={supplier.address ?? "-"} wide />
      <DetailItem label="Observaciones" value={supplier.notes ?? "-"} wide />
    </dl>
  );
}

const AMOUNT_FORMAT = new Intl.NumberFormat("es-GT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const SEARCH_DEBOUNCE_MS = 350;
const TAB_PAGE_SIZE = 10;

function MiniPager({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return <p className="text-xs font-semibold text-[var(--color-text-muted)]">{totalItems} registros</p>;
  }
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--color-text-muted)]">
      <span>
        Pagina {page} de {totalPages} · {totalItems} registros
      </span>
      <span className="flex gap-1">
        <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)} type="button" variant="secondary">
          Anterior
        </Button>
        <Button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
          variant="secondary"
        >
          Siguiente
        </Button>
      </span>
    </div>
  );
}

type TabPageState<T> = { key: string; status: "success"; data: PaginatedResult<T> } | { key: string; status: "error" };

/** API: productos on-demand al abrir la pestana; busqueda/filtro/paginacion en servidor (page base 1). */
function ApiProductsTab({
  supplierId,
  loadProducts,
}: {
  supplierId: string;
  loadProducts: (
    supplierId: string,
    params: OperationalSupplierProductPageParams,
  ) => Promise<PaginatedResult<OperationalSupplierProduct>>;
}) {
  const [search, setSearch] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<TabPageState<OperationalSupplierProduct> | null>(null);
  const key = `${supplierId}|${requestSearch}|${activeFilter}|${page}`;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setRequestSearch(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    let active = true;
    loadProducts(supplierId, {
      page,
      pageSize: TAB_PAGE_SIZE,
      ...(activeFilter === "all" ? {} : { active: activeFilter === "active" }),
      ...(requestSearch ? { search: requestSearch } : {}),
    })
      .then((data) => {
        if (active) setState({ key, status: "success", data });
      })
      .catch(() => {
        if (active) setState({ key, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [activeFilter, key, loadProducts, page, requestSearch, supplierId]);

  const current = state?.key === key ? state : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <Input
          aria-label="Buscar producto del proveedor"
          maxLength={TEXT_LIMITS.search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por producto o SKU..."
          type="search"
          value={search}
        />
        <Select
          aria-label="Estado del producto"
          onChange={(event) => {
            setActiveFilter(event.target.value as "all" | "active" | "inactive");
            setPage(1);
          }}
          value={activeFilter}
        >
          <option value="all">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </Select>
      </div>
      {!current ? (
        <p className="text-sm font-semibold text-[var(--color-text-muted)]">Cargando productos...</p>
      ) : current.status === "error" ? (
        <InlineAlert title="No se pudieron cargar los productos del proveedor." tone="danger" />
      ) : current.data.items.length === 0 ? (
        <EmptyPanel icon={PackageIcon} message="No hay productos asociados a este proveedor." />
      ) : (
        <>
          {current.data.items.map((product) => (
            <article className="rounded-md border border-[var(--color-border)] bg-white p-3" key={product.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-bold text-[var(--color-title)]">{product.productName}</p>
                  <p className="break-words text-xs text-[var(--color-text-muted)]">
                    {product.productSku}
                    {product.supplierSku ? ` | Cod. proveedor ${product.supplierSku}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {product.preferred ? (
                    <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">
                      Preferido
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold",
                      product.active ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700",
                    )}
                  >
                    {product.active ? "Activo" : "Inactivo"}
                  </span>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-sm sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                <StackedItem
                  label="Unidad de compra"
                  value={`${product.purchaseUnitSymbol} (x${formatNumber(product.purchaseToBaseFactor)})`}
                />
                <StackedItem label="Ultimo costo" value={AMOUNT_FORMAT.format(product.lastCost)} />
                <StackedItem label="Minimo" value={formatNumber(product.minimumOrderQuantity)} />
                <StackedItem
                  label="Entrega"
                  value={typeof product.leadTimeDays === "number" ? formatDays(product.leadTimeDays) : "No definido"}
                />
              </dl>
              <div className="mt-2 border-t border-[var(--color-border)] pt-2 text-sm">
                {product.costTiers.length === 0 ? (
                  <p className="text-[var(--color-text-muted)]">Sin tramos</p>
                ) : (
                  <details>
                    <summary className="cursor-pointer text-xs font-bold uppercase text-[var(--color-text-muted)]">
                      Tramos de precio ({product.costTiers.length})
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {product.costTiers.map((tier) => (
                        <span
                          className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-2 py-1 text-xs font-semibold text-[var(--color-text)]"
                          key={tier.minQuantity}
                        >
                          {formatNumber(tier.minQuantity)}+: {AMOUNT_FORMAT.format(tier.unitCost)}
                        </span>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </article>
          ))}
          <MiniPager
            onPageChange={setPage}
            page={current.data.page}
            totalItems={current.data.totalItems}
            totalPages={current.data.totalPages}
          />
        </>
      )}
    </div>
  );
}

const INCIDENT_STATUS_LABELS: Record<string, string> = { open: "Abierta", resolved: "Resuelta" };

function getIncidentTypeLabel(type: string) {
  return (RECEIPT_INCIDENT_TYPE_LABELS as Record<string, string>)[type] ?? "Otro";
}

/** API: incidencias on-demand (sucursal activa); filtro de estado y paginacion en servidor. */
function ApiIncidentsTab({
  supplierId,
  loadIncidents,
}: {
  supplierId: string;
  loadIncidents: (
    supplierId: string,
    params: Omit<OperationalSupplierIncidentPageParams, "branchId">,
  ) => Promise<PaginatedResult<OperationalSupplierIncident>>;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("all");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<TabPageState<OperationalSupplierIncident> | null>(null);
  const key = `${supplierId}|${statusFilter}|${page}`;

  useEffect(() => {
    let active = true;
    loadIncidents(supplierId, {
      page,
      pageSize: TAB_PAGE_SIZE,
      ...(statusFilter === "all" ? {} : { status: statusFilter }),
    })
      .then((data) => {
        if (active) setState({ key, status: "success", data });
      })
      .catch(() => {
        if (active) setState({ key, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [key, loadIncidents, page, statusFilter, supplierId]);

  const current = state?.key === key ? state : null;

  function openOrder(incident: OperationalSupplierIncident) {
    // El UUID viaja por sessionStorage; la URL queda limpia.
    saveOrdersNavContext({
      orderId: incident.purchaseOrderId,
      orderNumber: incident.purchaseOrderNumber,
      supplierId,
      source: "supplier",
    });
    router.push("/compras/ordenes");
  }

  return (
    <div className="space-y-3">
      <Select
        aria-label="Estado de la incidencia"
        onChange={(event) => {
          setStatusFilter(event.target.value as "all" | "open" | "resolved");
          setPage(1);
        }}
        value={statusFilter}
      >
        <option value="all">Todas</option>
        <option value="open">Abiertas</option>
        <option value="resolved">Resueltas</option>
      </Select>
      {!current ? (
        <p className="text-sm font-semibold text-[var(--color-text-muted)]">Cargando incidencias...</p>
      ) : current.status === "error" ? (
        <InlineAlert title="No se pudieron cargar las incidencias del proveedor." tone="danger" />
      ) : current.data.items.length === 0 ? (
        <EmptyPanel icon={AlertIcon} message="No hay incidencias registradas para este proveedor." />
      ) : (
        <>
          {current.data.items.map((incident) => (
            <article className="rounded-md border border-[var(--color-border)] bg-white p-3" key={incident.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-[var(--color-title)]">{getIncidentTypeLabel(incident.incidentType)}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{formatDate(incident.createdAt)}</p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-1 text-xs font-bold",
                    incident.status === "open" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
                  )}
                >
                  {INCIDENT_STATUS_LABELS[incident.status] ?? "Estado no disponible"}
                </span>
              </div>
              <p className="mt-2 break-words text-sm font-semibold text-[var(--color-text)]">
                {incident.productName
                  ? `${incident.productName}${typeof incident.quantityAffected === "number" ? ` · ${formatNumber(incident.quantityAffected)} afectadas` : ""}`
                  : "Incidencia general"}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--color-border)] pt-2 text-xs">
                <StackedItem label="Recepcion" value={incident.receiptNumber} />
                <div className="min-w-0">
                  <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">Orden de compra</dt>
                  <dd className="mt-0.5">
                    <button
                      className="font-bold text-[var(--color-structure)] underline-offset-2 hover:underline"
                      onClick={() => openOrder(incident)}
                      type="button"
                    >
                      {incident.purchaseOrderNumber}
                    </button>
                  </dd>
                </div>
                {incident.resolvedAt ? (
                  <StackedItem label="Resuelta el" value={formatDate(incident.resolvedAt)} />
                ) : null}
              </dl>
              {incident.notes ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-text)]">{incident.notes}</p>
              ) : null}

            </article>
          ))}
          <MiniPager
            onPageChange={setPage}
            page={current.data.page}
            totalItems={current.data.totalItems}
            totalPages={current.data.totalPages}
          />
        </>
      )}
    </div>
  );
}

/** API: solo email y telefono reales; no existe un contacto con nombre en el backend. */
function ApiContactTab({ supplier }: { supplier: SupplierListItemReadModel }) {
  if (!supplier.email && !supplier.phone) {
    return <EmptyPanel icon={UserIcon} message="Este proveedor no tiene datos de contacto registrados." />;
  }
  return (
    <dl className="grid gap-x-6 gap-y-0 rounded-md bg-white sm:grid-cols-2">
      <DetailItem label="Correo" value={supplier.email ?? "-"} />
      <DetailItem label="Telefono" value={supplier.phone ?? "-"} />
    </dl>
  );
}

/** API: ordenes recientes cargadas on-demand al abrir la pestana (una sola pagina). */
function ApiPurchasesTab({
  supplier,
  loadOrders,
}: {
  supplier: SupplierListItemReadModel;
  loadOrders: (supplierId: string) => Promise<SupplierPurchaseOrderReadModel[]>;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "success"; orders: SupplierPurchaseOrderReadModel[] }
  >({ status: "loading" });
  const supplierId = supplier.id;

  useEffect(() => {
    let active = true;
    loadOrders(supplierId)
      .then((orders) => {
        if (active) setState({ status: "success", orders });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [loadOrders, supplierId]);

  if (state.status === "loading") {
    return (
      <p className="text-sm font-semibold text-[var(--color-text-muted)]">
        Cargando ordenes de compra...
      </p>
    );
  }
  if (state.status === "error") {
    return <InlineAlert title="No se pudieron cargar las ordenes de compra." tone="danger" />;
  }
  return <PurchasesTab supplier={{ ...supplier, purchaseOrders: state.orders }} />;
}

function ContactsTab({ supplier }: { supplier: SupplierListItemReadModel }) {
  if (supplier.contacts.length === 0) {
    return <EmptyPanel icon={UserIcon} message="Este proveedor no tiene contactos registrados." />;
  }

  return (
    <div className="space-y-3">
      {supplier.contacts.map((contact) => (
        <article
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2.5"
          key={contact.id}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--color-title)]">{contact.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{contact.role ?? "-"}</p>
            </div>
            {contact.primary ? (
              <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800">
                Principal
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-[var(--color-text)]">
            {formatContactLine(contact.phone, contact.email)}
          </p>
        </article>
      ))}
    </div>
  );
}

function ProductsTab({ supplier }: { supplier: SupplierListItemReadModel }) {
  if (supplier.products.length === 0) {
    return (
      <EmptyPanel
        icon={PackageIcon}
        message="No hay productos ni costos asociados a este proveedor."
      />
    );
  }

  return (
    <div className="space-y-3">
      {supplier.products.map((product) => (
        <article
          className="rounded-md border border-[var(--color-border)] bg-white p-3"
          key={product.id}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-[var(--color-title)]">{product.productName}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {product.productSku} | {product.supplierSku ?? "Sin codigo proveedor"}
              </p>
            </div>
            {product.preferred ? (
              <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">
                Preferido
              </span>
            ) : null}
          </div>
          <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
            <InlineItem label="Unidad" value={product.purchaseUnitLabel} />
            <InlineItem label="Minimo" value={formatNumber(product.minimumOrderQuantity)} />
            <InlineItem label="Costo" value={formatCurrency(product.lastCost)} />
            <InlineItem label="Entrega" value={formatDays(product.leadTimeDays)} />
          </dl>
          <div className="mt-2 border-t border-[var(--color-border)] pt-2">
            <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
              Escalas de precio
            </p>
            {product.costTiers.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {product.costTiers.map((tier) => (
                  <span
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-2 py-1 text-xs font-semibold text-[var(--color-text)]"
                    key={tier.id}
                  >
                    {formatNumber(tier.minQuantity)}+: {formatCurrency(tier.unitCost)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Sin escalas registradas.
              </p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function PurchasesTab({ supplier }: { supplier: SupplierListItemReadModel }) {
  const router = useRouter();
  if (supplier.purchaseOrders.length === 0) {
    return <EmptyPanel icon={ClipboardIcon} message="No hay ordenes de compra asociadas." />;
  }

  function openOrder(order: SupplierListItemReadModel["purchaseOrders"][number]) {
    // El UUID viaja por sessionStorage; la URL queda limpia (/compras/ordenes).
    saveOrdersNavContext({
      orderId: order.id,
      orderNumber: order.number,
      supplierId: supplier.id,
      supplierName: supplier.name,
      source: "supplier",
    });
    router.push("/compras/ordenes");
  }

  return (
    <div className="space-y-2">
      {supplier.purchaseOrders.map((order) => (
        <button
          aria-label={`Ver orden de compra ${order.number} en ordenes`}
          className="group block min-h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2.5 text-left transition hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
          key={order.id}
          onClick={() => openOrder(order)}
          type="button"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-bold text-[var(--color-title)]">
                <span className="truncate">{order.number}</span>
                <OpenIcon className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--color-structure)]" />
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {formatDate(order.createdAt)}
                {order.expectedDate ? ` | Esperada ${formatDate(order.expectedDate)}` : ""}
              </p>
            </div>
            <PurchaseOrderStatusBadge status={order.status} />
          </div>
          <p className="mt-2 text-sm font-bold text-[var(--color-text)]">
            {formatCurrency(order.total)}
          </p>
        </button>
      ))}
    </div>
  );
}

function IncidentsTab({
  supplier,
  onSelect,
}: {
  supplier: SupplierListItemReadModel;
  onSelect: (incidentId: string) => void;
}) {
  if (supplier.incidents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] p-4 text-center">
        <AlertIcon className="mx-auto h-5 w-5 text-[var(--color-structure)]" />
        <p className="mt-2 text-sm font-semibold text-[var(--color-text-muted)]">
          No hay incidencias registradas.
        </p>
      </div>
    );
  }

  const canTotalAffectedUnits = supplier.incidents.every(
    (incident) => typeof incident.quantityAffected === "number",
  );
  const affectedUnits = canTotalAffectedUnits
    ? supplier.incidents.reduce((total, incident) => total + (incident.quantityAffected ?? 0), 0)
    : null;

  return (
    <div className="space-y-3">
      <dl
        className={cn(
          "grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3",
          affectedUnits === null ? "grid-cols-1" : "grid-cols-2",
        )}
      >
        <InlineMetric
          label="Incidencias registradas"
          value={formatNumber(supplier.incidents.length)}
        />
        {affectedUnits === null ? null : (
          <InlineMetric label="Unidades afectadas" value={formatNumber(affectedUnits)} />
        )}
      </dl>
      <div className="space-y-2">
        {supplier.incidents.map((incident) => (
          <SupplierIncidentCard incident={incident} key={incident.id} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function SupplierIncidentCard({
  incident,
  onSelect,
}: {
  incident: SupplierIncidentReadModel;
  onSelect: (incidentId: string) => void;
}) {
  return (
    <button
      aria-label={`Ver incidencia ${incident.typeName} de ${incident.productName}`}
      className="w-full rounded-md border border-[var(--color-border)] bg-white p-3 text-left transition hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
      onClick={() => onSelect(incident.id)}
      type="button"
    >
      <p className="truncate font-bold text-[var(--color-title)]" title={incident.productName}>
        {incident.productName}
      </p>
      <p
        className="mt-0.5 truncate text-xs font-semibold text-[var(--color-text-muted)]"
        title={incident.sku}
      >
        SKU {incident.sku}
      </p>
      <p className="mt-2 font-semibold text-amber-800">{incident.typeName}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-[var(--color-text-muted)]">
        <span>
          {incident.receiptNumber}
          {incident.purchaseOrderNumber ? ` · ${incident.purchaseOrderNumber}` : ""}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {typeof incident.quantityAffected === "number"
            ? `${formatNumber(incident.quantityAffected)} afectadas · `
            : ""}
          {formatDate(incident.date)}
        </span>
        {incident.evidence.length > 0 ? (
          <span>
            · {formatNumber(incident.evidence.length)}{" "}
            {incident.evidence.length === 1 ? "evidencia" : "evidencias"}
          </span>
        ) : null}
      </div>
      {incident.observation ? (
        <p
          className="mt-2 line-clamp-2 text-sm text-[var(--color-text)]"
          title={incident.observation}
        >
          {incident.observation}
        </p>
      ) : null}
    </button>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 text-xl font-bold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function DetailItem({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0 border-b border-[var(--color-border)] py-2.5",
        wide && "sm:col-span-2",
      )}
    >
      <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-[var(--color-title)]">
        {value}
      </dd>
    </div>
  );
}

/** Dato con la etiqueta arriba y el valor debajo (tarjetas de producto). */
function StackedItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words font-bold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function formatDays(days: number) {
  return `${days} ${days === 1 ? "día" : "días"}`;
}

/** Corrige la gramatica visual de etiquetas "N dias" generadas por el read model. */
function formatDeliveryLabel(label: string) {
  return label.replace(/^(\d+) dias$/, (_match, days: string) =>
    formatDays(Number(days)),
  );
}

function InlineItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-right font-bold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function EmptyPanel({ icon: Icon, message }: { icon: IconComponent; message: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] p-6 text-center">
      <Icon className="h-6 w-6 text-[var(--color-structure)]" />
      <p className="mt-2 text-sm font-semibold text-[var(--color-text-muted)]">{message}</p>
    </div>
  );
}

function formatContactLine(phone?: string, email?: string) {
  if (phone && email) return `${phone} | ${email}`;
  return phone ?? email ?? "-";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-GT").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function Icon({ children, className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

function BuildingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 21h18" />
      <path d="M5 21V7l8-4v18" />
      <path d="M19 21V11l-6-4" />
      <path d="M9 9h1" />
      <path d="M9 13h1" />
      <path d="M9 17h1" />
    </Icon>
  );
}

function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  );
}

function PackageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m3 7 9 5 9-5" />
      <path d="M12 22V12" />
      <path d="M21 7v10l-9 5-9-5V7l9-5 9 5Z" />
    </Icon>
  );
}

function ClipboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 5h6" />
      <path d="M9 3h6v4H9z" />
      <path d="M5 5h2" />
      <path d="M17 5h2v16H5V5" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </Icon>
  );
}

function BackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h10" />
    </Icon>
  );
}

function OpenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </Icon>
  );
}

function AlertIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m12 3 10 18H2L12 3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}
