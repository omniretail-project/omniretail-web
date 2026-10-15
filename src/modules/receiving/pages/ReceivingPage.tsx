"use client";

import { useMemo, useState, type SVGProps } from "react";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { TablePagination, type TablePageSize } from "@/shared/components/TablePagination";
import { useToast } from "@/shared/components/Toast";
import { cn } from "@/shared/utils/cn";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";
import type { ReceiptIncidentEvidence } from "@/core/entities";
import type {
  IncidentTypeReadModel,
  ReceivingDocumentRow,
  ReceivingIncidentRow,
  ReceivingStatus,
  ReceivingTab,
} from "@/modules/receiving/application/dto/ReceivingDocumentsDto";
import { IncidentDetailDrawer } from "@/modules/receiving/components/IncidentDetail";
import { useReceivingDocuments } from "@/modules/receiving/hooks/useReceivingDocuments";

const DEFAULT_PAGE_SIZE: TablePageSize = 10;
type ReceivingStatusFilter = ReceivingStatus | "all";
const STATUS_FILTERS: Array<{ value: ReceivingStatusFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendientes" },
  { value: "in_process", label: "En proceso" },
  { value: "partial", label: "Parciales" },
  { value: "received", label: "Recibidas" },
];

export function ReceivingPage() {
  const {
    data,
    filters,
    filteredDocuments,
    loading,
    loadingMore,
    error,
    incrementalError,
    hasMore,
    receiptHistoryIncomplete,
    incidentManagementAvailable,
    updateFilters,
    createIncidentType,
    archiveIncidentType,
    deleteIncidentType,
    loadMore,
  } = useReceivingDocuments();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<TablePageSize>(DEFAULT_PAGE_SIZE);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [incidentTypeModalOpen, setIncidentTypeModalOpen] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [previewEvidence, setPreviewEvidence] = useState<ReceiptIncidentEvidence | null>(null);
  const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedDocuments = useMemo(
    () => filteredDocuments.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, filteredDocuments, pageSize],
  );
  const selectedDocument = useMemo(
    () => data.documents.find((document) => document.id === selectedDocumentId) ?? null,
    [data.documents, selectedDocumentId],
  );
  const selectedIncident = useMemo(
    () => data.incidents.find((incident) => incident.id === selectedIncidentId) ?? null,
    [data.incidents, selectedIncidentId],
  );

  function handleTabChange(tab: ReceivingTab) {
    updateFilters({ tab });
    setSelectedDocumentId(null);
    setSelectedIncidentId(null);
  }

  function handleSearchChange(search: string) {
    updateFilters({ search });
    setPage(1);
    setSelectedDocumentId(null);
  }

  function handleStatusChange(status: ReceivingStatusFilter) {
    updateFilters({ status: status === "all" || filters.status === status ? "all" : status });
    setPage(1);
    setSelectedDocumentId(null);
  }

  function changePage(nextPage: number) {
    setPage(Math.min(Math.max(nextPage, 1), totalPages));
    setSelectedDocumentId(null);
  }

  function handlePageSizeChange(nextPageSize: TablePageSize) {
    setPageSize(nextPageSize);
    setPage(1);
    setSelectedDocumentId(null);
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Recepciones
        </p>
        <PageHeader
          title="Recepciones"
          description="Consulta ordenes, avances de recepcion e incidencias operativas."
          actions={incidentManagementAvailable ? (
            <Button
              onClick={() => setIncidentTypeModalOpen(true)}
              type="button"
              variant="secondary"
            >
              <AlertIcon />
              Tipos de incidencia
            </Button>
          ) : undefined}
        />
      </div>

      {error ? (
        <p className="rounded-md border border-[var(--color-danger)] bg-white px-4 py-3 text-sm font-medium text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      {incrementalError ? <InlineAlert title={incrementalError} tone="danger" /> : null}
      {receiptHistoryIncomplete ? (
        <InlineAlert
          title="El historial de recepciones está incompleto; se muestra únicamente la primera página disponible por orden."
          tone="warning"
        />
      ) : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <TabButton
              active={filters.tab === "orders"}
              label="Ordenes"
              onClick={() => handleTabChange("orders")}
            />
            <TabButton
              active={filters.tab === "incidents"}
              label="Incidencias"
              onClick={() => handleTabChange("incidents")}
            />
          </div>
          {filters.tab === "orders" ? (
            <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(260px,1fr)_auto] md:items-center">
              <Input
                aria-label="Buscar recepciones"
                className="h-10"
                maxLength={TEXT_LIMITS.search}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder="Buscar por orden, proveedor o producto..."
                type="search"
                value={filters.search}
              />
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((status) => (
                  <ChipButton
                    active={filters.status === status.value}
                    key={status.value}
                    label={status.label}
                    onClick={() => handleStatusChange(status.value)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {filters.tab === "orders" ? (
        <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
          {loading ? (
            <p className="p-5 text-sm text-[var(--color-text-muted)]">Cargando recepciones...</p>
          ) : (
            <>
              <ReceivingDocumentsTable
                documents={paginatedDocuments}
                selectedDocumentId={selectedDocumentId}
                onSelect={setSelectedDocumentId}
              />
              <TablePagination
                ariaLabel="Paginacion de recepciones"
                itemLabel="documentos"
                page={currentPage}
                pageSize={pageSize}
                totalItems={filteredDocuments.length}
                onPageChange={changePage}
                onPageSizeChange={handlePageSizeChange}
              />
              {hasMore ? (
                <div className="flex justify-center border-t border-[var(--color-border)] p-4">
                  <Button
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                    type="button"
                    variant="secondary"
                  >
                    {loadingMore ? "Cargando..." : "Cargar más"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : (
        <div className="space-y-3">
          {data.incidentListIncomplete ? (
            <InlineAlert
              title="Algunas recepciones tienen más incidencias que la primera página cargada. Abre la recepción correspondiente para consultar su estado canónico antes de confirmar."
              tone="warning"
            />
          ) : null}
          <IncidentsPanel
            incidents={data.incidents}
            loading={loading}
            selectedIncidentId={selectedIncidentId}
            onSelect={setSelectedIncidentId}
          />
        </div>
      )}

      <SelectedDocumentModal
        document={selectedDocument}
        onClose={() => setSelectedDocumentId(null)}
      />

      {selectedIncident ? (
        <IncidentDetailDrawer
          incident={selectedIncident}
          onClose={() => setSelectedIncidentId(null)}
          onPreview={setPreviewEvidence}
        />
      ) : null}

      {incidentManagementAvailable ? (
        <IncidentTypesModal
          incidentTypes={data.incidentTypes}
          open={incidentTypeModalOpen}
          onArchive={archiveIncidentType}
          onClose={() => setIncidentTypeModalOpen(false)}
          onCreate={createIncidentType}
          onDelete={deleteIncidentType}
        />
      ) : null}
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

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "min-h-9 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
        active
          ? "border-blue-200 bg-blue-100 text-[var(--color-title)] shadow-sm"
          : "border-[var(--color-border)] bg-white text-[var(--color-title)] hover:bg-[var(--color-app-background)]",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function ChipButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "min-h-9 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
        active
          ? "border-blue-200 bg-blue-100 text-[var(--color-title)] shadow-sm"
          : "border-[var(--color-border)] bg-white text-[var(--color-title)] hover:bg-[var(--color-app-background)]",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function ReceivingDocumentsTable({
  documents,
  selectedDocumentId,
  onSelect,
}: {
  documents: ReceivingDocumentRow[];
  selectedDocumentId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-sm">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[22%]" />
          <col className="w-[14%]" />
          <col className="w-[12%]" />
          <col className="w-[20%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Numero de documento</th>
            <th className="px-4 py-2.5 font-semibold">Proveedor</th>
            <th className="px-4 py-2.5 font-semibold">Fecha esperada</th>
            <th className="px-4 py-2.5 text-right font-semibold">Productos</th>
            <th className="px-4 py-2.5 font-semibold">Progreso de recepcion</th>
            <th className="px-4 py-2.5 font-semibold">Ultima actualizacion</th>
          </tr>
        </thead>
        <tbody>
          {documents.length === 0 ? (
            <tr>
              <td className="px-4 py-10 text-center text-[var(--color-text-muted)]" colSpan={6}>
                <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                  <PackageIcon className="h-6 w-6 text-[var(--color-structure)]" />
                  <p className="font-bold text-[var(--color-title)]">
                    No se encontraron documentos para recepcion.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            documents.map((document) => (
              <tr
                className={cn(
                  "cursor-pointer border-l-4 border-t border-[var(--color-border)] transition hover:bg-[var(--color-primary)]/5 focus-visible:bg-[var(--color-primary)]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-structure)]",
                  getRowStatusClassName(document.status),
                  selectedDocumentId === document.id &&
                    "border-l-4 border-l-[var(--color-structure)] bg-[var(--color-primary)]/10",
                )}
                key={document.id}
                onClick={() => onSelect(document.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSelect(document.id);
                }}
                tabIndex={0}
              >
                <td className="px-4 py-3">
                  <p className="font-bold text-[var(--color-title)]">{document.documentNumber}</p>
                  <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">
                    {document.documentTypeLabel}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p className="truncate font-semibold text-[var(--color-title)]">
                    {document.supplierOrSource}
                  </p>
                  <div className="mt-1">
                    <ReceivingStatusBadge status={document.status} />
                  </div>
                </td>
                <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                  {document.expectedDate ? formatDate(document.expectedDate) : "-"}
                </td>
                <td className="px-4 py-3 text-right font-bold text-[var(--color-title)]">
                  {formatNumber(document.productCount)}
                </td>
                <td className="px-4 py-3">
                  <ReceivingProgress document={document} />
                </td>
                <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                  {formatDate(document.lastUpdatedAt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SelectedDocumentModal({
  document,
  onClose,
}: {
  document: ReceivingDocumentRow | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(document)}
      title={document?.documentNumber ?? "Detalle de recepcion"}
      subtitle={
        document ? `${document.documentTypeLabel} · ${document.supplierOrSource}` : undefined
      }
      onClose={onClose}
      footer={
        document ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              className="w-full sm:w-auto"
              href={getReceivingDocumentHref(document)}
              type="button"
            >
              {document.status === "received" ? <EyeIcon /> : <PackageIcon />}
              {getPreparedActionLabel(document.status)}
            </Button>
          </div>
        ) : undefined
      }
      size="lg"
    >
      {document ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ReceivingStatusBadge status={document.status} />
            <span className="text-sm font-semibold text-[var(--color-text-muted)]">
              {document.documentTypeLabel}
            </span>
          </div>
          <dl className="grid gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] p-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailItem
              label={document.documentType === "purchase_order" ? "Proveedor" : "Sucursal origen"}
              value={document.supplierOrSource}
            />
            <DetailItem label="Estado" value={document.statusLabel} />
            <DetailItem label="Productos" value={formatNumber(document.productCount)} />
            <DetailItem label="Solicitado" value={formatNumber(document.requestedQuantity)} />
            <DetailItem label="Aceptado" value={formatNumber(document.receivedQuantity)} />
            <DetailItem
              label="Pendiente"
              value={formatNumber(
                Math.max(0, document.requestedQuantity - document.receivedQuantity),
              )}
            />
            <DetailItem
              label="Progreso"
              value={`${formatNumber(document.receivedQuantity)} / ${formatNumber(document.requestedQuantity)}`}
            />
            <DetailItem
              label="Fecha esperada"
              value={document.expectedDate ? formatDate(document.expectedDate) : "-"}
            />
            <DetailItem label="Ultima actualizacion" value={formatDate(document.lastUpdatedAt)} />
          </dl>
        </div>
      ) : null}
    </Modal>
  );
}

function IncidentsPanel({
  incidents,
  loading,
  selectedIncidentId,
  onSelect,
}: {
  incidents: ReceivingIncidentRow[];
  loading: boolean;
  selectedIncidentId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <section className="rounded-lg border border-[var(--color-border)] bg-white p-5 shadow-sm">
        <p className="text-sm text-[var(--color-text-muted)]">Cargando incidencias...</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
      {incidents.length === 0 ? (
        <div className="flex flex-col items-center rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] px-4 py-6 text-center">
          <AlertIcon className="h-6 w-6 text-amber-600" />
          <p className="mt-2 text-sm font-bold text-[var(--color-title)]">
            No hay incidencias registradas.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {incidents.map((incident) => (
            <button
              aria-label={`Ver incidencia ${incident.typeName} de ${incident.productName}`}
              className={cn(
                "grid w-full min-w-0 gap-3 rounded-lg border p-3 text-left transition sm:p-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(160px,0.8fr)] lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(180px,0.85fr)_auto] lg:items-center",
                selectedIncidentId === incident.id
                  ? "border-[var(--color-primary)] bg-blue-50 ring-2 ring-[var(--color-primary)]/20"
                  : "border-[var(--color-border)] bg-white hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/[0.03]",
              )}
              key={incident.id}
              onClick={() => onSelect(incident.id)}
              type="button"
            >
              <div className="min-w-0">
                <p
                  className="truncate font-bold text-[var(--color-title)]"
                  title={incident.productName}
                >
                  {incident.productName}
                </p>
                <p
                  className="mt-1 truncate text-xs font-semibold text-[var(--color-text-muted)]"
                  title={incident.sku}
                >
                  SKU {incident.sku}
                </p>
                <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs font-bold text-[var(--color-text)]">
                  <span>{incident.receiptNumber}</span>
                  {incident.purchaseOrderNumber ? (
                    <span>{incident.purchaseOrderNumber}</span>
                  ) : null}
                </p>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-amber-800">{incident.typeName}</p>
                  {incident.status ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-bold",
                        incident.status === "open"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800",
                      )}
                    >
                      {incident.status === "open" ? "Abierta" : "Resuelta"}
                    </span>
                  ) : null}
                </div>
                <p
                  className="mt-1 line-clamp-2 break-words text-sm text-[var(--color-text)]"
                  title={incident.observation}
                >
                  {incident.observation}
                </p>
              </div>
              <div className="min-w-0 text-sm text-[var(--color-text)]">
                {incident.supplierName ? (
                  <p
                    className="truncate font-semibold text-[var(--color-title)]"
                    title={incident.supplierName}
                  >
                    {incident.supplierName}
                  </p>
                ) : null}
                <p className="mt-1">{formatDate(incident.date)}</p>
                {typeof incident.quantityAffected === "number" ? (
                  <p className="mt-1 font-bold text-[var(--color-title)]">
                    {formatNumber(incident.quantityAffected)} afectadas
                  </p>
                ) : null}
              </div>
              {incident.evidence.length > 0 ? (
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)] md:col-start-3 lg:col-start-auto lg:justify-self-end">
                  <CameraIcon className="h-4 w-4" />
                  <span>{incident.evidence.length}</span>
                  <span className="sr-only">evidencias</span>
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function IncidentTypesModal({
  open,
  incidentTypes,
  onClose,
  onCreate,
  onArchive,
  onDelete,
}: {
  open: boolean;
  incidentTypes: IncidentTypeReadModel[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    setSaving(true);
    try {
      await onCreate(name);
      setName("");
      showToast({ title: "Tipo de incidencia agregado", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo agregar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(incidentType: IncidentTypeReadModel) {
    if (!window.confirm(`Archivar ${incidentType.name}?`)) return;
    setSaving(true);
    try {
      await onArchive(incidentType.id);
      showToast({ title: "Tipo archivado", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo archivar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(incidentType: IncidentTypeReadModel) {
    if (!window.confirm(`Eliminar ${incidentType.name}?`)) return;
    setSaving(true);
    try {
      await onDelete(incidentType.id);
      showToast({ title: "Tipo eliminado", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo eliminar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      subtitle="Administra la lista operativa para clasificar incidencias de recepcion."
      title="Tipos de incidencia"
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            aria-label="Nombre del tipo de incidencia"
            disabled={saving}
            maxLength={TEXT_LIMITS.incidentName}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleCreate();
            }}
            placeholder="Nombre del tipo de incidencia"
            value={name}
          />
          <Button disabled={saving || !name.trim()} onClick={handleCreate} type="button">
            <PlusIcon />
            Agregar
          </Button>
        </div>

        <div className="space-y-2">
          {incidentTypes.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] px-4 py-6 text-center text-sm font-medium text-[var(--color-text-muted)]">
              No hay tipos configurados.
            </p>
          ) : (
            incidentTypes.map((incidentType) => (
              <article
                className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-3 sm:flex-row sm:items-center sm:justify-between"
                key={incidentType.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-bold text-[var(--color-title)]">
                    {incidentType.name}
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                    {formatNumber(incidentType.usageCount)} usos -{" "}
                    {incidentType.active ? "Activo" : "Archivado"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {incidentType.canDelete ? (
                    <Button
                      className="min-h-9 px-3 py-1.5"
                      disabled={saving}
                      onClick={() => void handleDelete(incidentType)}
                      type="button"
                      variant="danger"
                    >
                      <TrashIcon />
                      Eliminar
                    </Button>
                  ) : null}
                  {incidentType.canArchive ? (
                    <Button
                      className="min-h-9 px-3 py-1.5"
                      disabled={saving}
                      onClick={() => void handleArchive(incidentType)}
                      type="button"
                      variant="secondary"
                    >
                      <ArchiveIcon />
                      Archivar
                    </Button>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

function ReceivingProgress({ document }: { document: ReceivingDocumentRow }) {
  const percentage =
    document.requestedQuantity <= 0
      ? 0
      : Math.min(100, Math.round((document.receivedQuantity / document.requestedQuantity) * 100));
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--color-text)]">
        {formatNumber(document.receivedQuantity)} / {formatNumber(document.requestedQuantity)}
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-app-background)]">
        <div
          className={cn(
            "h-full rounded-full",
            document.status === "received" && "bg-emerald-500",
            document.status === "partial" && "bg-orange-500",
            document.status === "in_process" && "bg-amber-500",
            document.status === "pending" && "bg-rose-400",
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function ReceivingStatusBadge({ status }: { status: ReceivingStatus }) {
  const classes: Record<ReceivingStatus, string> = {
    pending: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
    in_process: "bg-amber-100 text-amber-800",
    partial: "bg-orange-100 text-orange-800",
    received: "bg-emerald-100 text-emerald-800",
  };
  return (
    <span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-bold", classes[status])}>
      {getStatusLabel(status)}
    </span>
  );
}

function getRowStatusClassName(status: ReceivingStatus) {
  const classes: Record<ReceivingStatus, string> = {
    pending: "border-l-rose-300",
    in_process: "border-l-amber-300",
    partial: "border-l-orange-300",
    received: "border-l-emerald-300",
  };
  return classes[status];
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function getStatusLabel(status: ReceivingStatus) {
  const labels: Record<ReceivingStatus, string> = {
    pending: "Pendiente",
    in_process: "En proceso",
    partial: "Parcial",
    received: "Recibida",
  };
  return labels[status];
}

function getPreparedActionLabel(status: ReceivingStatus) {
  if (status === "received") return "Ver detalle";
  if (status === "pending") return "Iniciar recepcion";
  return "Continuar recepcion";
}

function getReceivingDocumentHref(document: ReceivingDocumentRow) {
  return `/compras/recepciones/${document.documentType}/${document.documentId}`;
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
      className={cn("h-4 w-4 shrink-0", className)}
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

function AlertIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

function CameraIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M8 7 9.5 5h5L16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3Z" />
      <circle cx="12" cy="13" r="3" />
    </Icon>
  );
}

function ArchiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </Icon>
  );
}

function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
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

function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </Icon>
  );
}
