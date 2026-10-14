import type {
  BusinessCapabilitiesConfig,
  InventoryTransferItem,
  InventoryMovement,
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  Receipt,
  ReceiptIncident,
  ReceiptLine,
  StorageLocation,
  StockLot,
  SerialNumber,
  Unit,
  User,
} from "@/core/entities";
import {
  DispatchStatus,
  InventoryMovementType,
  InventoryTransferStatus,
  LocationStatus,
  PurchaseOrderStatus,
  ReceiptLineStatus,
  ReceiptStatus,
} from "@/core/enums";
import {
  EXPIRATION_BEFORE_ENTRY_MESSAGE,
  getLocalCalendarDate,
  isExpirationBeforeOperationDate,
} from "@/core/inventory/expirationDate";
import type {
  ReceiptDraftInput,
  ReceiptDraftItemInput,
  ReceiptDraftTrackingDetailInput,
  ReceiptIncidentRecord,
  ReceiptItemRecord,
  ReceiptRecord,
  ReceiptRepository,
} from "@/core/repositories";
import { RECEIPT_INCIDENT_NOTES_MAX_LENGTH } from "@/core/repositories/ReceiptRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import type {
  ConfirmReceivingInput,
  CreateReceivingIncidentInput,
  ReceivingCapabilityFlags,
  ReceivingDocumentDetail,
  ReceivingDocumentDetailType,
  ReceivingDocumentIncident,
  ReceivingDocumentLine,
  ReceivingTrackingDetail,
  SaveReceivingProgressInput,
  TransferReceptionReadModel,
} from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import { RECEIPT_INCIDENT_TYPE_LABELS } from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import {
  ensureCanConfirmReceiving,
  ensureCanManageReceivingIncidents,
  ensureCanReadReceiving,
  ensureCanSaveReceivingProgress,
  ensureTenantCanUseReceiving,
  ensureUserCanOperateBranch,
  ReceivingServiceError,
  resolveReceivingContext,
} from "@/modules/receiving/application/services/serviceHelpers";
import type { TenantEntitlementsDto } from "@/shared/application/dto/EntitlementDto";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import { isEffectiveBusinessCapabilityEnabled } from "@/shared/application/services/businessCapabilityEntitlement";
import { isQuantityCompatibleWithUnit, toFiniteNumber } from "@/shared/utils/numberInput";
import {
  MAX_SAFE_INVENTORY_QUANTITY,
  QUANTITY_DECIMAL_PLACES,
  TEXT_LIMITS,
} from "@/shared/utils/inputLimits";

type ReceivingDocumentContent = Omit<
  ReceivingDocumentDetail,
  "dataSource" | "canConfirm" | "canManageIncidents"
>;

type ReceivingIncidentValidationContext = Pick<ReceivingDocumentContent, "lines" | "incidentTypes">;

type ReceivingLineValidationContext = Pick<
  ReceivingDocumentContent,
  "document" | "lines" | "incidentTypes" | "capabilities"
> &
  Partial<Pick<ReceivingDocumentDetail, "dataSource">>;

/**
 * Arranca todas las lecturas independientes antes de esperar capabilities. La unica dependencia
 * intencional es locations, porque con multiubicacion apagada esa peticion no debe existir.
 */
export async function loadReceivingReadsInParallel<
  TCapabilities extends { supportsMultipleLocations: boolean },
  TIndependent extends readonly unknown[],
  TLocation,
>(input: {
  loadCapabilities: () => Promise<TCapabilities>;
  independentLoaders: { [K in keyof TIndependent]: () => Promise<TIndependent[K]> };
  loadLocations: () => Promise<TLocation[]>;
}): Promise<{
  capabilities: TCapabilities;
  independent: TIndependent;
  locations: TLocation[];
}> {
  const capabilitiesPromise = input.loadCapabilities();
  const independentPromise = Promise.all(
    input.independentLoaders.map((loader) => loader()),
  ) as unknown as Promise<TIndependent>;
  const locationsPromise = capabilitiesPromise.then((capabilities) =>
    capabilities.supportsMultipleLocations ? input.loadLocations() : Promise.resolve([]),
  );
  const [capabilities, independent, locations] = await Promise.all([
    capabilitiesPromise,
    independentPromise,
    locationsPromise,
  ]);
  return { capabilities, independent, locations };
}

export class ReceivingDocumentDetailService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async getDocument(
    documentType: ReceivingDocumentDetailType,
    documentId: string,
    activeBranchId?: string,
  ): Promise<ReceivingDocumentDetail> {
    const { tenantId, user, permissions } = await resolveReceivingContext(this.repositories);
    ensureCanReadReceiving(permissions);
    const content =
      documentType === "purchase_order"
        ? await this.getPurchaseOrderDocument(tenantId, user, documentId, activeBranchId)
        : await this.getTransferDocument(tenantId, user, documentId, activeBranchId);
    const canConfirm = permissions.includes("receiving.receipts.confirm");
    const canManageTransfer = permissions.includes("inventory.transfers.manage");
    const transferReception = content.transferReception
      ? applyTransferReceptionPermissions(
          content.transferReception,
          canConfirm && canManageTransfer,
        )
      : undefined;
    return {
      ...content,
      ...(transferReception ? { transferReception } : {}),
      dataSource: this.repositories.receivingDataSource,
      canConfirm,
      canManageIncidents: permissions.includes("receiving.incidents.manage"),
    };
  }

  async saveProgress(input: SaveReceivingProgressInput): Promise<Receipt> {
    if (input.documentType !== "purchase_order") {
      throw new ReceivingServiceError(
        "La recepcion de traslados aun no esta soportada por el contrato Receipt.",
      );
    }
    const { tenantId, actorUserId, user, permissions } = await resolveReceivingContext(
      this.repositories,
    );
    ensureCanSaveReceivingProgress(permissions);
    await ensureTenantCanUseReceiving(this.repositories, tenantId);
    const order = await this.requirePurchaseOrder(tenantId, user, input.documentId);
    const detail = await this.getPurchaseOrderDocument(tenantId, user, input.documentId);
    const validationErrors =
      this.repositories.receivingDataSource === "api"
        ? validateApiDraftLines(input.lines, detail)
        : validateIncidentQuantities(input.lines, input.incidents, detail);
    if (validationErrors.length > 0) throw new ReceivingServiceError(validationErrors[0]);
    if (this.repositories.receivingDataSource === "api") {
      if (detail.draftEditingLocked) {
        throw new ReceivingServiceError(
          "No es seguro reemplazar los productos del borrador porque tiene incidencias por línea o la lista de incidencias está incompleta.",
        );
      }
      return this.saveApiDraft(order, input);
    }
    const receipt = await this.ensureInProgressReceipt(order, actorUserId);
    await this.persistDraft(receipt, input, detail, actorUserId);
    return this.repositories.receipts.update(receipt.id, { status: ReceiptStatus.in_progress });
  }

  async deleteDraft(receiptId: string): Promise<void> {
    const { tenantId, permissions } = await resolveReceivingContext(this.repositories);
    ensureCanSaveReceivingProgress(permissions);
    await ensureTenantCanUseReceiving(this.repositories, tenantId);
    if (this.repositories.receivingDataSource === "api") {
      const current = await this.repositories.receipts.getRecordByIdScoped(tenantId, receiptId);
      if (!current || current.receipt.status !== ReceiptStatus.in_progress) {
        throw new ReceivingServiceError("No se encontró el borrador de recepción solicitado.");
      }
      const incidentPage = await this.repositories.receipts.listIncidentsScoped(
        tenantId,
        current.receipt.id,
        { page: 1, pageSize: 1 },
      );
      if (incidentPage.totalItems > 0) {
        throw new ReceivingServiceError(
          "No se puede eliminar un borrador con incidencias porque el backend conserva sus referencias históricas.",
        );
      }
    }
    await this.repositories.receipts.deleteDraftScoped(tenantId, receiptId);
  }

  async confirm(input: ConfirmReceivingInput): Promise<Receipt> {
    if (input.documentType === "transfer") {
      return this.confirmTransfer(input);
    }
    const { tenantId, actorUserId, user, permissions } = await resolveReceivingContext(
      this.repositories,
    );
    ensureCanConfirmReceiving(permissions);
    await ensureTenantCanUseReceiving(this.repositories, tenantId);
    const order = await this.requirePurchaseOrder(tenantId, user, input.documentId);
    if (this.repositories.receivingDataSource === "api") {
      return this.confirmApiReceipt(order, input);
    }
    const confirmationId = input.confirmationId.trim();
    if (!confirmationId) {
      throw new ReceivingServiceError("La confirmacion de recepcion requiere una identidad.");
    }
    const confirmationFingerprint = getReceivingConfirmationFingerprint(input, order);
    const existingConfirmation = await this.repositories.receipts.getByConfirmationId(
      order.tenantId,
      confirmationId,
    );
    if (existingConfirmation) {
      if (existingConfirmation.confirmationFingerprint !== confirmationFingerprint) {
        throw new ReceivingServiceError(
          `La confirmacion ${confirmationId} ya fue usada con datos distintos.`,
        );
      }
      return existingConfirmation;
    }
    const detail = await this.getPurchaseOrderDocument(tenantId, user, input.documentId);
    const now = new Date().toISOString();
    const operationDate = getLocalCalendarDate();
    const validationErrors = validateLines(input.lines, input.incidents, detail, operationDate);
    if (validationErrors.length > 0) {
      throw new ReceivingServiceError(validationErrors[0]);
    }
    const receipt = await this.ensureInProgressReceipt(order, actorUserId);
    const receiptLines = input.lines.map((line) => toReceiptLineInput(line, input.incidents));
    const receiptIncidents = toReceiptIncidentInputs(input, detail, actorUserId);

    return this.repositories.receipts.confirmReceiptInventory({
      receiptId: receipt.id,
      tenantId: order.tenantId,
      confirmationId,
      confirmationFingerprint,
      receivedByUserId: actorUserId,
      receivedAt: now,
      notes: buildReceiptNotes(receiptLines),
      lines: receiptLines,
      incidents: receiptIncidents,
    });
  }

  async createIncident(input: CreateReceivingIncidentInput): Promise<ReceiptIncidentRecord> {
    const { tenantId, user, permissions } = await resolveReceivingContext(this.repositories);
    ensureCanManageReceivingIncidents(permissions);
    await ensureTenantCanUseReceiving(this.repositories, tenantId);
    if (this.repositories.receivingDataSource !== "api") {
      throw new ReceivingServiceError("Esta operación corresponde únicamente a Receipt API.");
    }
    const order = await this.requirePurchaseOrder(tenantId, user, input.documentId);
    const record = await this.requireApiDraftRecord(tenantId, input.receiptId, order.id);
    if (record.receipt.branchId !== order.branchId) {
      throw new ReceivingServiceError("El borrador no pertenece a la sucursal de la orden.");
    }
    const notes = input.notes.trim();
    if (!notes) throw new ReceivingServiceError("Agrega la observación de la incidencia.");
    if (notes.length > RECEIPT_INCIDENT_NOTES_MAX_LENGTH) {
      throw new ReceivingServiceError(
        `La observación admite hasta ${RECEIPT_INCIDENT_NOTES_MAX_LENGTH.toLocaleString("en-US")} caracteres.`,
      );
    }
    if (!input.goodsReceiptItemId) {
      if (input.quantityAffected !== undefined) {
        throw new ReceivingServiceError(
          "Una incidencia general no debe incluir cantidad afectada.",
        );
      }
    } else {
      const item = record.items.find((candidate) => candidate.line.id === input.goodsReceiptItemId);
      if (!item) {
        throw new ReceivingServiceError("La línea recibida no pertenece al borrador actual.");
      }
      const quantity = input.quantityAffected;
      // La cantidad afectada es mercancia NO aceptada: se limita por lo pendiente de la orden
      // (pedido - aceptado - otras incidencias abiertas), no por lo recibido. El backend decide.
      const current = await this.getApiPurchaseOrderDocument(order);
      const currentLine = current.lines.find(
        (candidate) => candidate.goodsReceiptItemId === input.goodsReceiptItemId,
      );
      const capacity =
        currentLine && !current.receiptHistoryIncomplete
          ? getIncidentCapacity(currentLine, current.incidents)
          : undefined;
      if (
        quantity === undefined ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        (capacity !== undefined && quantity > capacity)
      ) {
        throw new ReceivingServiceError(
          capacity !== undefined
            ? `La cantidad afectada debe estar entre 0 y ${capacity}.`
            : "La cantidad afectada debe ser mayor a 0.",
        );
      }
      const units = await this.repositories.units.getAll();
      const unit = units.find((candidate) => candidate.id === item.unitId);
      if (!isQuantityCompatibleWithUnit(quantity, unit?.allowsDecimals ?? false)) {
        throw new ReceivingServiceError(
          unit?.allowsDecimals
            ? `La cantidad afectada admite hasta ${QUANTITY_DECIMAL_PLACES} decimales.`
            : "La unidad recibida no admite cantidades fraccionarias.",
        );
      }
    }
    return this.repositories.receipts.createIncidentScoped({
      tenantId,
      receiptId: record.receipt.id,
      incidentType: input.incidentType,
      ...(input.goodsReceiptItemId ? { goodsReceiptItemId: input.goodsReceiptItemId } : {}),
      ...(input.quantityAffected !== undefined ? { quantityAffected: input.quantityAffected } : {}),
      notes,
    });
  }

  async resolveIncident(
    documentId: string,
    receiptId: string,
    incidentId: string,
    trackingDetails?: ReceiptDraftTrackingDetailInput[],
  ): Promise<ReceiptIncidentRecord> {
    const { tenantId, user, permissions } = await resolveReceivingContext(this.repositories);
    ensureCanManageReceivingIncidents(permissions);
    await ensureTenantCanUseReceiving(this.repositories, tenantId);
    if (this.repositories.receivingDataSource !== "api") {
      throw new ReceivingServiceError("Esta operación corresponde únicamente a Receipt API.");
    }
    const order = await this.requirePurchaseOrder(tenantId, user, documentId);
    const record = await this.requireApiDraftRecord(tenantId, receiptId, order.id);
    if (record.receipt.branchId !== order.branchId) {
      throw new ReceivingServiceError("El borrador no pertenece a la sucursal de la orden.");
    }
    const incidentPage = await this.repositories.receipts.listIncidentsScoped(
      tenantId,
      record.receipt.id,
      { page: 1, pageSize: 100 },
    );
    if (!incidentPage.items.some((incident) => incident.id === incidentId)) {
      throw new ReceivingServiceError("La incidencia no pertenece al borrador actual.");
    }
    const incident = incidentPage.items.find((candidate) => candidate.id === incidentId);
    if (incident?.status !== "open") {
      throw new ReceivingServiceError("La incidencia ya está resuelta.");
    }
    if (incident.quantityAffected === undefined) {
      return this.repositories.receipts.resolveIncidentScoped(tenantId, incidentId);
    }
    await this.repositories.receipts.resolveIncidentWithReplacementScoped({
      tenantId,
      receiptId: record.receipt.id,
      incidentId,
      replacementQuantity: incident.quantityAffected,
      ...(trackingDetails && trackingDetails.length > 0 ? { trackingDetails } : {}),
    });
    return { ...incident, status: "resolved" as const };
  }

  /** Precheck UX en una sola request batch; no sustituye la validacion del backend. */
  async validateSerials(productId: string, serialNumbers: string[]) {
    const { permissions } = await resolveReceivingContext(this.repositories);
    ensureCanReadReceiving(permissions);
    return this.repositories.receipts.validateSerialNumbersScoped({ productId, serialNumbers });
  }

  private async confirmTransfer(input: ConfirmReceivingInput): Promise<Receipt> {
    const { tenantId, actorUserId, user, permissions } = await resolveReceivingContext(
      this.repositories,
    );
    ensureCanConfirmReceiving(permissions);
    await ensureTenantCanUseReceiving(this.repositories, tenantId);
    const transfer = await this.repositories.inventoryTransfers.getById(input.documentId);
    if (!transfer || transfer.transfer.tenantId !== tenantId) {
      throw new ReceivingServiceError("Traslado no encontrado.");
    }
    await ensureUserCanOperateBranch(
      this.repositories,
      user,
      transfer.transfer.destinationBranchId,
    );
    const session = await resolveCurrentSessionSnapshot(this.repositories);
    const activeBranchId = session.sessionId
      ? (await this.repositories.auth.getSession(session.sessionId))?.activeBranchId
      : undefined;
    if (activeBranchId !== transfer.transfer.destinationBranchId) {
      throw new ReceivingServiceError(
        "La sucursal destino debe estar activa para recibir el traslado.",
      );
    }
    if (this.repositories.inventoryTransfersDataSource === "api") {
      return this.confirmApiTransfer(input, tenantId, actorUserId, user, permissions, transfer);
    }
    if (!(await this.hasTransferDispatchEvidence(transfer))) {
      throw new ReceivingServiceError("El traslado no tiene una salida de despacho verificable.");
    }
    if (input.incidents.length > 0) {
      throw new ReceivingServiceError("La recepción de traslado no admite incidencias parciales.");
    }
    const capabilities = await this.getCapabilities(tenantId);
    if (!capabilities.supportsMultipleLocations) {
      throw new ReceivingServiceError(
        "La recepción de traslados sin ubicaciones múltiples requiere actualizar el contrato de traslado.",
      );
    }
    const [locations, settingsEntries] = await Promise.all([
      this.repositories.inventory.getLocations(transfer.transfer.destinationBranchId),
      Promise.all(
        transfer.items.map(
          async (item) =>
            [
              item.productId,
              await this.repositories.inventory.getProductInventorySettings(
                item.productId,
                transfer.transfer.destinationBranchId,
              ),
            ] as const,
        ),
      ),
    ]);
    const settingsByProductId = new Map(settingsEntries);
    const items = input.lines
      .filter((line) => toFiniteNumber(line.receivedNow) > 0)
      .map((line) => {
        const item = transfer.items.find(
          (entry) => entry.id === line.sourceLineId && entry.productId === line.productId,
        );
        const quantity = line.receivedNow;
        const operationalLocationId = item
          ? resolveReceivingLineLocation({
              tenantId,
              branchId: transfer.transfer.destinationBranchId,
              defaultLocationId: settingsByProductId.get(item.productId)?.defaultLocationId,
              supportsMultipleLocations: true,
              locations,
            })
          : "";
        if (
          !item ||
          typeof quantity !== "number" ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !operationalLocationId ||
          line.locationId !== operationalLocationId
        ) {
          throw new ReceivingServiceError("Selecciona una cantidad y ubicación válidas.");
        }
        return {
          itemId: item.id,
          receivedQuantity: quantity,
          locationId: line.locationId,
          lotNumber: line.lotNumber,
          expirationDate: line.expirationDate,
          serialNumbers: parseSerialNumbers(line.serialNumbersText),
        };
      });
    if (items.length === 0) {
      throw new ReceivingServiceError("Selecciona al menos una cantidad para recibir.");
    }
    await this.repositories.inventoryTransfers.markReceived(transfer.transfer.id, {
      receivedByUserId: actorUserId,
      confirmationId: input.confirmationId,
      items,
    });
    const receipt = await this.repositories.receipts.getByConfirmationId(
      tenantId,
      input.confirmationId,
    );
    if (!receipt || receipt.inventoryTransferId !== transfer.transfer.id) {
      throw new ReceivingServiceError("No se pudo recuperar la recepción confirmada.");
    }
    return receipt;
  }

  private async confirmApiTransfer(
    input: ConfirmReceivingInput,
    tenantId: string,
    actorUserId: string,
    user: User,
    permissions: readonly string[],
    transfer: NonNullable<Awaited<ReturnType<RepositoryRegistry["inventoryTransfers"]["getById"]>>>,
  ): Promise<Receipt> {
    if (!permissions.includes("inventory.transfers.manage")) {
      throw new ReceivingServiceError("No dispone de permisos para confirmar traslados.");
    }
    const confirmationId = input.confirmationId.trim();
    if (!confirmationId) {
      throw new ReceivingServiceError("La confirmación de recepción requiere una identidad.");
    }
    if (input.incidents.length > 0) {
      throw new ReceivingServiceError("La recepción de traslado no admite incidencias parciales.");
    }
    const detail = await this.getTransferDocument(
      tenantId,
      user,
      transfer.transfer.id,
      transfer.transfer.destinationBranchId,
    );
    const reception = detail.transferReception;
    const destinationLocationId = reception?.destinationLocationId;
    if (!reception?.canConfirmTransfer || !destinationLocationId) {
      throw new ReceivingServiceError(
        reception?.blockingReason ?? "El traslado no puede confirmarse en su estado actual.",
      );
    }
    const canonicalLines = new Map(detail.lines.map((line) => [line.sourceLineId, line]));
    const receivedItemIds = new Set<string>();
    const items = input.lines.flatMap((line) => {
      const quantity = toFiniteNumber(line.receivedNow);
      if (quantity <= 0) return [];
      const canonical = canonicalLines.get(line.sourceLineId);
      const item = transfer.items.find(
        (candidate) => candidate.id === line.sourceLineId && candidate.productId === line.productId,
      );
      if (!canonical || !item || receivedItemIds.has(item.id)) {
        throw new ReceivingServiceError("La línea recibida no pertenece al traslado actual.");
      }
      if (!Number.isFinite(quantity) || quantity > canonical.pendingQuantity) {
        throw new ReceivingServiceError(
          `${canonical.productName}: la cantidad recibida excede lo pendiente.`,
        );
      }
      if (canonical.tracking.lot || canonical.tracking.serial) {
        throw new ReceivingServiceError(
          `${canonical.productName}: el Backend aún no expone las selecciones físicas despachadas requeridas para recibir lotes o series.`,
        );
      }
      receivedItemIds.add(item.id);
      return [
        {
          itemId: item.id,
          receivedQuantity: quantity,
          // La ubicación llega del estado canónico recién leído; nunca de una línea manipulable
          // por la interfaz. La API acepta una única ubicación por confirmación.
          locationId: destinationLocationId,
        },
      ];
    });
    if (items.length === 0) {
      throw new ReceivingServiceError("Selecciona al menos una cantidad para recibir.");
    }
    const confirmedTransfer = await this.repositories.inventoryTransfers.markReceived(
      transfer.transfer.id,
      {
        receivedByUserId: actorUserId,
        confirmationId,
        items,
      },
    );
    const confirmedAt = confirmedTransfer.transfer.receivedAt ?? new Date().toISOString();
    return {
      id: `transfer-receipt:${confirmedTransfer.transfer.id}:${confirmationId}`,
      tenantId,
      branchId: confirmedTransfer.transfer.destinationBranchId,
      number: `REC-${confirmedTransfer.transfer.number}`,
      inventoryTransferId: confirmedTransfer.transfer.id,
      confirmationId,
      receivedByUserId: actorUserId,
      receivedAt: confirmedAt,
      status: ReceiptStatus.received,
      createdAt: confirmedAt,
      updatedAt: confirmedAt,
    };
  }

  private async persistDraft(
    receipt: Receipt,
    input: SaveReceivingProgressInput,
    detail: Pick<ReceivingDocumentContent, "lines">,
    actorUserId: string,
  ) {
    const savedLines = await this.repositories.receipts.replaceLines(
      receipt.id,
      input.lines.map((line) => toReceiptLineInput(line, input.incidents)),
    );
    const lineByProductId = new Map(savedLines.map((line) => [line.productId, line]));
    const validProductIds = new Set(detail.lines.map((line) => line.productId));
    await this.repositories.receipts.replaceIncidents(
      receipt.id,
      input.incidents.flatMap((incident) => {
        const productId = incident.productId;
        if (!incident.editable || !productId || !validProductIds.has(productId)) return [];
        const receiptLine = lineByProductId.get(productId);
        return [
          {
            ...(!incident.id.startsWith("draft-") ? { id: incident.id } : {}),
            ...(incident.createdAt ? { createdAt: incident.createdAt } : {}),
            ...(receiptLine ? { receiptLineId: receiptLine.id } : {}),
            incidentTypeId: incident.incidentTypeId,
            description: incident.description.trim(),
            quantityAffected: incident.quantityAffected,
            evidence: incident.evidence,
            // Un incidente NUEVO (id "draft-...") solo tiene un placeholder de UI en
            // createdByUserId (nunca la identidad real, que solo la sesion conoce) -- se
            // ignora y se usa siempre el actor resuelto server-side. Uno YA persistido
            // conserva su atribucion original.
            createdByUserId: incident.id.startsWith("draft-")
              ? actorUserId
              : incident.createdByUserId || actorUserId,
          },
        ];
      }),
    );
    return savedLines;
  }

  private async getPurchaseOrderDocument(
    tenantId: string,
    user: User,
    documentId: string,
    activeBranchId?: string,
  ): Promise<ReceivingDocumentContent> {
    const order = await this.requirePurchaseOrder(tenantId, user, documentId);
    // Filtro de VISTA opcional (no de seguridad): si el hook pasa una sucursal activa distinta
    // a la del documento, se rechaza para no mostrar un documento de otra sucursal dentro de un
    // contexto ya filtrado -- la autorizacion real (User.allowedBranchIds) ya ocurrio arriba, en
    // requirePurchaseOrder.
    if (activeBranchId && order.branchId !== activeBranchId) {
      throw new ReceivingServiceError("El documento no pertenece a la sucursal activa.");
    }
    if (this.repositories.receivingDataSource === "api") {
      return this.getApiPurchaseOrderDocument(order);
    }
    const [suppliers, branches, products, units, locations, receipts, incidentTypes, users] =
      await Promise.all([
        this.repositories.suppliers.getAll(),
        this.repositories.branches.getAll(),
        this.repositories.products.getAll(),
        this.repositories.units.getAll(),
        this.repositories.inventory.getLocations(order.branchId),
        this.repositories.receipts.listByTenant(tenantId),
        this.repositories.incidentTypes.getAll(),
        this.repositories.users.getAll(),
      ]);
    const branch = branches.find((item) => item.id === order.branchId);
    const [capabilities, entitlements] = await Promise.all([
      this.getCapabilities(order.tenantId),
      new ResolveTenantEntitlementsService(this.repositories).execute(order.tenantId),
    ]);
    const orderReceipts = receipts.filter(
      (receipt) =>
        receipt.purchaseOrderId === order.id &&
        receipt.branchId === order.branchId &&
        receipt.status !== ReceiptStatus.cancelled,
    );
    const receiptLines = (
      await Promise.all(
        orderReceipts.map((receipt) => this.repositories.receipts.getLinesByReceipt(receipt.id)),
      )
    ).flat();
    const incidents = await this.repositories.receipts.getIncidents();
    const settings = await this.getInventorySettings(order);
    const productById = new Map(products.map((product) => [product.id, product]));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const lineByReceiptLineId = new Map(receiptLines.map((line) => [line.id, line]));
    const receiptById = new Map(orderReceipts.map((receipt) => [receipt.id, receipt]));
    const userNameById = new Map(users.map((user) => [user.id, user.name]));
    const locationNameById = new Map(locations.map((location) => [location.id, location.name]));
    const inProgressReceipt = orderReceipts.find(
      (receipt) => receipt.status === ReceiptStatus.in_progress,
    );
    const inProgressLines = receiptLines.filter((line) => line.receiptId === inProgressReceipt?.id);
    const confirmedReceipts = orderReceipts.filter(
      (receipt) =>
        receipt.status === ReceiptStatus.partial || receipt.status === ReceiptStatus.received,
    );
    const confirmedLines = receiptLines.filter((line) =>
      confirmedReceipts.some(
        (receipt) =>
          receipt.id === line.receiptId &&
          (receipt.status === ReceiptStatus.partial || receipt.status === ReceiptStatus.received),
      ),
    );

    return {
      document: {
        id: order.id,
        type: "purchase_order",
        number: order.number,
        typeLabel: "Orden de compra",
        originLabel: "Proveedor",
        originName:
          suppliers.find((supplier) => supplier.id === order.supplierId)?.name ??
          "Proveedor no disponible",
        branchId: order.branchId,
        branchName: branch?.name ?? "Sucursal destino",
        tenantId: order.tenantId,
        ...(order.expectedDate ? { expectedDate: order.expectedDate } : {}),
        statusLabel: getPurchaseOrderStatusLabel(order.status),
        ...(inProgressReceipt
          ? { receiptId: inProgressReceipt.id, receiptNumber: inProgressReceipt.number }
          : {}),
      },
      lines: await Promise.all(
        (order.items ?? []).map((item) =>
          this.toPurchaseOrderDetailLine({
            item,
            product: productById.get(item.productId),
            unit: unitById.get(item.unitId),
            baseUnitById: unitById,
            inProgressLine: inProgressLines.find((line) => line.productId === item.productId),
            confirmedLines: confirmedLines.filter((line) => line.productId === item.productId),
            settingsDefaultLocationId: settings.get(item.productId)?.defaultLocationId ?? undefined,
            locations,
            tenantId: order.tenantId,
            branchId: order.branchId,
            supportsMultipleLocations: capabilities.supportsMultipleLocations,
          }),
        ),
      ),
      locations: toLocationOptions(locations, capabilities, order.tenantId, order.branchId),
      incidentTypes: incidentTypes
        .filter((type) => type.tenantId === order.tenantId && type.active)
        .map((type) => ({ id: type.id, name: type.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      incidents: toIncidentRows(
        incidents.filter((incident) =>
          orderReceipts.some((receipt) => receipt.id === incident.receiptId),
        ),
        incidentTypes,
        lineByReceiptLineId,
        productById,
        receiptById,
        userNameById,
        inProgressReceipt?.id,
      ),
      previousReceipts: buildPreviousReceipts({
        receipts: confirmedReceipts,
        receiptLines,
        incidents,
        incidentTypes,
        productById,
        unitById,
        locationNameById,
        userNameById,
        orderItems: order.items ?? [],
        orderNumber: order.number,
        orderedTotal: (order.items ?? []).reduce((sum, item) => sum + item.quantity, 0),
      }),
      capabilities: toCapabilityFlags(capabilities, entitlements),
      readOnly: order.status === PurchaseOrderStatus.received,
    };
  }

  private async getApiPurchaseOrderDocument(
    order: PurchaseOrder,
  ): Promise<ReceivingDocumentContent> {
    const tenantId = order.tenantId;
    // Unica fuente humana operacional en modo API: el usuario de la sesion. Los historicos de otros
    // usuarios no son resolvibles sin un contrato backend no administrativo (se muestran neutros).
    const { user: sessionUser } = await resolveReceivingContext(this.repositories);
    const apiUserNameById = new Map([[sessionUser.id, sessionUser.name]]);
    const productIds = [...new Set((order.items ?? []).map((item) => item.productId))];
    const reads = await loadReceivingReadsInParallel({
      loadCapabilities: () => this.getCapabilities(tenantId),
      independentLoaders: [
        () => new ResolveTenantEntitlementsService(this.repositories).execute(tenantId),
        () => this.repositories.branches.getAll(),
        () =>
          Promise.all(
            productIds.map((productId) =>
              this.repositories.products.getByIdScoped(tenantId, productId),
            ),
          ),
        () => this.repositories.units.getAll(),
        () =>
          this.repositories.receipts.getPageScoped(tenantId, {
            branchId: order.branchId,
            purchaseOrderId: order.id,
            status: "draft",
            page: 1,
            pageSize: 100,
          }),
        () =>
          this.repositories.receipts.getPageScoped(tenantId, {
            branchId: order.branchId,
            purchaseOrderId: order.id,
            status: "confirmed",
            page: 1,
            pageSize: 100,
          }),
        () => this.getInventorySettings(order),
      ] as const,
      loadLocations: () => this.repositories.inventory.getLocations(order.branchId),
    });
    const [
      entitlements,
      branches,
      products,
      units,
      draftReceiptPage,
      confirmedReceiptPage,
      settings,
    ] = reads.independent;
    const { capabilities, locations } = reads;
    if (draftReceiptPage.totalItems > 1) {
      throw new ReceivingServiceError(
        "La orden tiene varios borradores de recepción. Resuelve el conflicto antes de editar.",
      );
    }
    const receiptHistoryIncomplete = isReceiptHistoryIncomplete(
      confirmedReceiptPage.page,
      confirmedReceiptPage.totalPages,
    );
    const branch = branches.find((item) => item.id === order.branchId);
    const receiptRecords = [...draftReceiptPage.items, ...confirmedReceiptPage.items];
    const orderReceipts = receiptRecords.map((record) => record.receipt);
    const receiptLines = receiptRecords.flatMap((record) => record.items.map((item) => item.line));
    const productById = new Map(
      products
        .filter((product): product is Product => product !== null)
        .map((product) => [product.id, product]),
    );
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const inProgressRecord = draftReceiptPage.items.find(
      (record) => record.receipt.status === ReceiptStatus.in_progress,
    );
    const inProgressReceipt = inProgressRecord?.receipt;
    let apiIncidents: ReceivingDocumentIncident[] = [];
    let incidentListIncomplete = false;
    if (inProgressRecord) {
      const incidentPage = await this.repositories.receipts.listIncidentsScoped(
        tenantId,
        inProgressRecord.receipt.id,
        { page: 1, pageSize: 100 },
      );
      apiIncidents = toApiIncidentRows(incidentPage.items, inProgressRecord, apiUserNameById);
      incidentListIncomplete = incidentPage.page < incidentPage.totalPages;
    }
    // Proteccion por linea: cualquier incidencia (abierta o resuelta) fija ese GoodsReceiptItem.
    // Solo si la lista esta incompleta no puede saberse que lineas estan protegidas y se bloquea
    // todo el borrador (comportamiento conservador).
    const protectedItemIds = new Set(
      apiIncidents.flatMap((incident) =>
        incident.goodsReceiptItemId ? [incident.goodsReceiptItemId] : [],
      ),
    );
    const draftEditingLocked = incidentListIncomplete;
    const confirmedReceipts = orderReceipts.filter(
      (receipt) => receipt.status === ReceiptStatus.received,
    );
    const confirmedReceiptIds = new Set(confirmedReceipts.map((receipt) => receipt.id));
    const confirmedLines = receiptHistoryIncomplete
      ? []
      : receiptLines.filter((line) => confirmedReceiptIds.has(line.receiptId));
    const locationNameById = new Map(locations.map((location) => [location.id, location.name]));

    return {
      document: {
        id: order.id,
        type: "purchase_order",
        number: order.number,
        typeLabel: "Orden de compra",
        originLabel: "Proveedor",
        originName: order.supplierNameSnapshot ?? "Proveedor no disponible",
        branchId: order.branchId,
        branchName: branch?.name ?? "Sucursal destino",
        tenantId,
        ...(order.expectedDate ? { expectedDate: order.expectedDate } : {}),
        statusLabel: getPurchaseOrderStatusLabel(order.status),
        ...(inProgressReceipt
          ? { receiptId: inProgressReceipt.id, receiptNumber: inProgressReceipt.number }
          : {}),
      },
      lines: await Promise.all(
        (order.items ?? []).map((item) => {
          const inProgressItem = inProgressRecord?.items.find(
            (recordItem) => recordItem.purchaseOrderItemId === item.id,
          );
          return this.toPurchaseOrderDetailLine({
            item,
            product: productById.get(item.productId),
            unit: unitById.get(item.unitId),
            baseUnitById: unitById,
            inProgressLine: inProgressItem?.line,
            inProgressItem,
            confirmedLines: confirmedLines.filter((line) => line.productId === item.productId),
            settingsDefaultLocationId: settings.get(item.productId)?.defaultLocationId ?? undefined,
            locations,
            tenantId,
            branchId: order.branchId,
            supportsMultipleLocations: capabilities.supportsMultipleLocations,
          }).then((line) =>
            inProgressItem && protectedItemIds.has(inProgressItem.line.id)
              ? { ...line, incidentProtected: true }
              : line,
          );
        }),
      ),
      locations: toLocationOptions(locations, capabilities, tenantId, order.branchId),
      incidentTypes: getApiIncidentTypeOptions(),
      incidents: apiIncidents,
      previousReceipts: receiptHistoryIncomplete
        ? []
        : buildPreviousReceipts({
            receipts: confirmedReceipts,
            receiptLines,
            incidents: [],
            incidentTypes: [],
            productById,
            unitById,
            locationNameById,
            userNameById: apiUserNameById,
            orderItems: order.items ?? [],
            orderNumber: order.number,
            orderedTotal: (order.items ?? []).reduce((sum, item) => sum + item.quantity, 0),
          }),
      capabilities: toCapabilityFlags(capabilities, entitlements),
      readOnly: isApiReceivingReadOnly(order.status, false, receiptHistoryIncomplete),
      ...(draftEditingLocked ? { draftEditingLocked: true } : {}),
      ...(incidentListIncomplete ? { incidentListIncomplete: true } : {}),
      ...(receiptHistoryIncomplete ? { receiptHistoryIncomplete: true } : {}),
    };
  }

  private async saveApiDraft(
    order: PurchaseOrder,
    input: SaveReceivingProgressInput,
  ): Promise<Receipt> {
    const items = toApiDraftItems(input.lines);
    if (items.length === 0) {
      throw new ReceivingServiceError("Ingresa al menos una cantidad recibida para guardar.");
    }
    const draft = {
      tenantId: order.tenantId,
      items,
    };
    const record = await persistApiDraftWithHistoryGuard(
      this.repositories.receipts,
      order.tenantId,
      order.branchId,
      order.id,
      draft,
    );
    return record.receipt;
  }

  private async confirmApiReceipt(
    order: PurchaseOrder,
    input: ConfirmReceivingInput,
  ): Promise<Receipt> {
    const detail = await this.getApiPurchaseOrderDocument(order);
    if (detail.readOnly) {
      throw new ReceivingServiceError("La recepción no puede confirmarse en su estado actual.");
    }
    const validationErrors = validateApiDraftLines(input.lines, detail);
    if (validationErrors.length > 0) {
      throw new ReceivingServiceError(validationErrors[0]);
    }
    // El borrador guardado puede conservar una ubicacion distinta de la operativa actual que la
    // pantalla ya muestra: confirmarlo tal cual lo rechazaria el backend. Se reguarda primero.
    const staleLocationToPersist = hasStaleLocationToPersist(detail, input.lines);
    if (detail.draftEditingLocked && staleLocationToPersist) {
      throw new ReceivingServiceError(STALE_LOCATION_LOCKED_DRAFT_MESSAGE);
    }
    if (detail.draftEditingLocked && input.hasUnsavedChanges) {
      throw new ReceivingServiceError(
        "No es seguro reemplazar los productos del borrador porque tiene incidencias por línea o la lista de incidencias está incompleta. Confirma usando el estado canónico guardado cuando todas las incidencias estén resueltas.",
      );
    }

    let receiptId = detail.document.receiptId;
    if (input.hasUnsavedChanges || staleLocationToPersist || !receiptId) {
      const saved = await this.saveApiDraft(order, input);
      receiptId = saved.id;
    }
    const record = await this.requireApiDraftRecord(order.tenantId, receiptId, order.id);
    const incidentPage = await this.repositories.receipts.listIncidentsScoped(
      order.tenantId,
      record.receipt.id,
      { page: 1, pageSize: 100 },
    );
    if (incidentPage.items.some((incident) => incident.status === "open")) {
      throw new ReceivingServiceError(
        "La recepción tiene incidencias abiertas que deben resolverse antes de confirmar.",
      );
    }
    if (incidentPage.page < incidentPage.totalPages) {
      throw new ReceivingServiceError(
        "No se puede confirmar porque la lista de incidencias está incompleta y no es posible comprobar que todas estén resueltas.",
      );
    }
    const confirmed = await this.repositories.receipts.confirmDraftScoped(
      order.tenantId,
      record.receipt.id,
    );
    return confirmed.receipt;
  }

  private async requireApiDraftRecord(
    tenantId: string,
    receiptId: string,
    purchaseOrderId: string,
  ): Promise<ReceiptRecord> {
    const record = await this.repositories.receipts.getRecordByIdScoped(tenantId, receiptId);
    if (
      !record ||
      record.receipt.purchaseOrderId !== purchaseOrderId ||
      record.receipt.status !== ReceiptStatus.in_progress
    ) {
      throw new ReceivingServiceError("No se encontró el borrador de recepción solicitado.");
    }
    return record;
  }

  /**
   * El detalle API no consulta dispatches, movimientos, lotes ni series mock. El estado y las
   * cantidades del traslado provienen del Backend; las líneas trazables quedan bloqueadas hasta
   * que el contrato exponga las selecciones físicas despachadas.
   */
  private async getApiTransferDocument(
    tenantId: string,
    user: User,
    documentId: string,
    activeBranchId?: string,
  ): Promise<ReceivingDocumentContent> {
    const transfer = await this.repositories.inventoryTransfers.getById(documentId);
    if (transfer?.transfer.tenantId !== tenantId) {
      throw new ReceivingServiceError("Traslado no encontrado.");
    }
    await ensureUserCanOperateBranch(
      this.repositories,
      user,
      transfer.transfer.destinationBranchId,
    );
    if (activeBranchId && transfer.transfer.destinationBranchId !== activeBranchId) {
      throw new ReceivingServiceError("El traslado no pertenece a la sucursal activa.");
    }

    const destinationBranchId = transfer.transfer.destinationBranchId;
    const [branches, units, locations, capabilities, entitlements, products, settingsEntries] =
      await Promise.all([
        this.repositories.branches.getAll(),
        this.repositories.units.getAll(),
        this.repositories.inventory.getLocations(destinationBranchId),
        this.getCapabilities(tenantId),
        new ResolveTenantEntitlementsService(this.repositories).execute(tenantId),
        Promise.all(
          transfer.items.map((item) =>
            this.repositories.products.getByIdScoped(tenantId, item.productId),
          ),
        ),
        Promise.all(
          transfer.items.map(
            async (item) =>
              [
                item.productId,
                await this.repositories.inventory.getProductInventorySettings(
                  item.productId,
                  destinationBranchId,
                ),
              ] as const,
          ),
        ),
      ]);
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const productById = new Map(
      products
        .filter((product): product is Product => product !== null)
        .map((product) => [product.id, product]),
    );
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const activeLocationById = new Map(
      locations
        .filter(
          (location) =>
            location.tenantId === tenantId &&
            location.branchId === destinationBranchId &&
            location.status === LocationStatus.active,
        )
        .map((location) => [location.id, location]),
    );
    const settingsByProductId = new Map(settingsEntries);
    const lines = transfer.items.map((item) => {
      const settings = settingsByProductId.get(item.productId);
      const configuredLocationId =
        settings?.tenantId === tenantId &&
        settings.branchId === destinationBranchId &&
        settings.productId === item.productId &&
        settings.defaultLocationId &&
        activeLocationById.has(settings.defaultLocationId)
          ? settings.defaultLocationId
          : "";
      return this.toTransferDetailLine(
        item,
        productById.get(item.productId),
        unitById,
        configuredLocationId,
      );
    });
    const receivable = await this.hasTransferDispatchEvidence(transfer);
    const transferReception = buildApiTransferReception({
      lines,
      transferIsReceivable: receivable,
      activeLocationById,
      productById,
    });

    return {
      document: {
        id: transfer.transfer.id,
        type: "transfer",
        number: transfer.transfer.number,
        typeLabel: "Traslado",
        originLabel: "Sucursal origen",
        originName:
          branchById.get(transfer.transfer.sourceBranchId)?.name ?? "Sucursal origen no disponible",
        branchId: destinationBranchId,
        branchName: branchById.get(destinationBranchId)?.name ?? "Sucursal destino",
        tenantId,
        statusLabel:
          transfer.transfer.status === InventoryTransferStatus.received
            ? "Recibida"
            : "En tránsito",
      },
      lines,
      locations: toLocationOptions(locations, capabilities, tenantId, destinationBranchId),
      incidentTypes: [],
      incidents: [],
      previousReceipts: [],
      capabilities: toCapabilityFlags(capabilities, entitlements),
      readOnly: !transferReception.canConfirmTransfer,
      transferReception,
    };
  }

  private async getTransferDocument(
    tenantId: string,
    user: User,
    documentId: string,
    activeBranchId?: string,
  ): Promise<ReceivingDocumentContent> {
    if (this.repositories.inventoryTransfersDataSource === "api") {
      return this.getApiTransferDocument(tenantId, user, documentId, activeBranchId);
    }
    const transfer = await this.repositories.inventoryTransfers.getById(documentId);
    // El id llega desde la URL/estado del cliente: un traslado de otro tenant se trata igual
    // que uno inexistente, mismo criterio que requirePurchaseOrder.
    if (!transfer || transfer.transfer.tenantId !== tenantId) {
      throw new ReceivingServiceError("Traslado no encontrado.");
    }
    await ensureUserCanOperateBranch(
      this.repositories,
      user,
      transfer.transfer.destinationBranchId,
    );
    if (activeBranchId && transfer.transfer.destinationBranchId !== activeBranchId) {
      throw new ReceivingServiceError("El traslado no pertenece a la sucursal activa.");
    }
    const [branches, products, units, locations, movements, lots, serials] = await Promise.all([
      this.repositories.branches.getAll(),
      this.repositories.products.getAll(),
      this.repositories.units.getAll(),
      this.repositories.inventory.getLocations(transfer.transfer.destinationBranchId),
      this.repositories.inventory.getMovements(),
      this.repositories.inventory.getLots(),
      this.repositories.inventory.getSerialNumbers(),
    ]);
    const [capabilities, entitlements] = await Promise.all([
      this.getCapabilities(transfer.transfer.tenantId),
      new ResolveTenantEntitlementsService(this.repositories).execute(transfer.transfer.tenantId),
    ]);
    const settings = new Map(
      await Promise.all(
        transfer.items.map(
          async (item) =>
            [
              item.productId,
              await this.repositories.inventory.getProductInventorySettings(
                item.productId,
                transfer.transfer.destinationBranchId,
              ),
            ] as const,
        ),
      ),
    );
    const activeDestinationLocations = locations.filter(
      (location) =>
        location.tenantId === tenantId &&
        location.branchId === transfer.transfer.destinationBranchId &&
        location.status === LocationStatus.active,
    );
    const receivable =
      transfer.transfer.status === InventoryTransferStatus.inTransit &&
      (await this.hasTransferDispatchEvidence(transfer));
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const productById = new Map(products.map((product) => [product.id, product]));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    return {
      document: {
        id: transfer.transfer.id,
        type: "transfer",
        number: transfer.transfer.number,
        typeLabel: "Traslado",
        originLabel: "Sucursal origen",
        originName:
          branchById.get(transfer.transfer.sourceBranchId)?.name ?? "Sucursal origen no disponible",
        branchId: transfer.transfer.destinationBranchId,
        branchName:
          branchById.get(transfer.transfer.destinationBranchId)?.name ?? "Sucursal destino",
        tenantId: transfer.transfer.tenantId,
        statusLabel:
          transfer.transfer.status === InventoryTransferStatus.received
            ? "Recibida"
            : "En transito",
      },
      lines: transfer.items.flatMap((item) => {
        const productSettings = settings.get(item.productId);
        const configuredLocationId =
          productSettings?.tenantId === tenantId &&
          productSettings.branchId === transfer.transfer.destinationBranchId &&
          productSettings.productId === item.productId &&
          activeDestinationLocations.some(
            (location) => location.id === productSettings.defaultLocationId,
          )
            ? productSettings.defaultLocationId
            : undefined;
        const product = productById.get(item.productId);
        const outgoing = movements.filter(
          (movement) =>
            movement.tenantId === tenantId &&
            movement.branchId === transfer.transfer.sourceBranchId &&
            movement.productId === item.productId &&
            movement.referenceType === "transfer" &&
            movement.referenceId === documentId &&
            movement.type === InventoryMovementType.out,
        );
        const incoming = movements.filter(
          (movement) =>
            movement.tenantId === tenantId &&
            movement.branchId === transfer.transfer.destinationBranchId &&
            movement.productId === item.productId &&
            movement.referenceType === "transfer" &&
            movement.referenceId === documentId &&
            movement.type === InventoryMovementType.in,
        );
        const groups = buildTransferTraceabilityGroups(outgoing, incoming, lots, serials, product);
        return (groups.length ? groups : [undefined]).map((group) =>
          this.toTransferDetailLine(
            item,
            product,
            unitById,
            capabilities.supportsMultipleLocations ? (configuredLocationId ?? "") : "",
            group,
            !receivable,
          ),
        );
      }),
      locations: toLocationOptions(
        locations,
        capabilities,
        tenantId,
        transfer.transfer.destinationBranchId,
      ),
      incidentTypes: [],
      incidents: [],
      previousReceipts: [],
      capabilities: toCapabilityFlags(capabilities, entitlements),
      readOnly: !receivable,
    };
  }

  private async hasTransferDispatchEvidence(
    transfer: NonNullable<Awaited<ReturnType<RepositoryRegistry["inventoryTransfers"]["getById"]>>>,
  ): Promise<boolean> {
    if (this.repositories.inventoryTransfersDataSource === "api") {
      return (
        transfer.transfer.status === InventoryTransferStatus.inTransit &&
        transfer.items.length > 0 &&
        transfer.items.every(
          (item) =>
            item.dispatchedQuantity > 0 &&
            item.receivedQuantity >= 0 &&
            item.receivedQuantity <= item.dispatchedQuantity,
        )
      );
    }
    const { tenantId, sourceBranchId, id } = transfer.transfer;
    const [dispatches, movements] = await Promise.all([
      this.repositories.dispatches.getAll({ tenantId, branchId: sourceBranchId }),
      this.repositories.inventory.getMovements(),
    ]);
    const matchingDispatches = dispatches.filter(
      (entry) =>
        entry.sourceType === "transfer" &&
        entry.sourceId === id &&
        entry.status === DispatchStatus.dispatched,
    );
    if (matchingDispatches.length !== 1) return false;
    const outgoing = movements.filter(
      (entry) =>
        entry.tenantId === tenantId &&
        entry.branchId === sourceBranchId &&
        entry.referenceType === "transfer" &&
        entry.referenceId === id &&
        entry.type === InventoryMovementType.out,
    );
    if (
      transfer.items.length === 0 ||
      transfer.items.some(
        (item) =>
          item.dispatchedQuantity <= 0 || item.dispatchedQuantity !== item.requestedQuantity,
      )
    )
      return false;
    if (
      outgoing.reduce((sum, entry) => sum + entry.quantity, 0) !==
      transfer.items.reduce((sum, item) => sum + item.dispatchedQuantity, 0)
    )
      return false;
    return transfer.items.every(
      (item) =>
        outgoing
          .filter((entry) => entry.productId === item.productId)
          .reduce((sum, entry) => sum + entry.quantity, 0) === item.dispatchedQuantity,
    );
  }

  private async toPurchaseOrderDetailLine(input: {
    item: PurchaseOrderItem;
    product?: Product;
    unit?: Unit;
    baseUnitById: Map<string, Unit>;
    inProgressLine?: ReceiptLine;
    inProgressItem?: ReceiptItemRecord;
    confirmedLines: ReceiptLine[];
    settingsDefaultLocationId?: string | null;
    locations: StorageLocation[];
    tenantId: string;
    branchId: string;
    supportsMultipleLocations: boolean;
  }): Promise<ReceivingDocumentLine> {
    const product = input.product;
    const baseUnit = product ? input.baseUnitById.get(product.baseUnitId) : undefined;
    const acceptedPreviously = input.confirmedLines.reduce(
      (sum, line) => sum + line.receivedQuantity,
      0,
    );
    const receivedNow = input.inProgressLine ? input.inProgressLine.receivedQuantity : "";
    const purchaseToBaseFactor = input.item.purchaseToBaseFactor;
    const locationId = resolveReceivingLineLocation({
      tenantId: input.tenantId,
      branchId: input.branchId,
      savedLocationId: input.inProgressLine?.locationId,
      defaultLocationId: input.settingsDefaultLocationId,
      supportsMultipleLocations: input.supportsMultipleLocations,
      locations: input.locations,
    });
    return {
      id: input.item.id,
      sourceLineId: input.item.id,
      ...(input.inProgressLine?.id ? { receiptLineId: input.inProgressLine.id } : {}),
      ...(input.inProgressItem?.line.id
        ? { goodsReceiptItemId: input.inProgressItem.line.id }
        : {}),
      productId: input.item.productId,
      productName: product?.name ?? input.item.productNameSnapshot ?? "Producto no disponible",
      sku: product?.sku ?? input.item.productSkuSnapshot ?? "-",
      unitId: input.item.unitId,
      unitName: input.unit?.name ?? input.item.unitSymbolSnapshot ?? "Unidad",
      unitAllowsDecimals: input.unit?.allowsDecimals ?? false,
      baseUnitId: product?.baseUnitId ?? input.item.unitId,
      baseUnitName: baseUnit?.name ?? input.unit?.name ?? "Unidad base",
      baseUnitAllowsDecimals: baseUnit?.allowsDecimals ?? input.unit?.allowsDecimals ?? false,
      orderedQuantity: input.item.quantity,
      acceptedPreviously,
      receivedNow,
      pendingQuantity: Math.max(
        0,
        input.item.quantity - acceptedPreviously - Math.max(0, toFiniteNumber(receivedNow)),
      ),
      locationId,
      defaultLocationId: input.settingsDefaultLocationId ?? undefined,
      ...(input.inProgressLine?.locationId && input.inProgressLine.locationId !== locationId
        ? { staleSavedLocationId: input.inProgressLine.locationId }
        : {}),
      tracking: product?.tracking ?? { stock: false, lot: false, expiration: false, serial: false },
      lotNumber: input.inProgressLine?.lotNumber ?? input.inProgressLine?.lotId ?? "",
      expirationDate: input.inProgressLine?.expirationDate?.slice(0, 10) ?? "",
      serialNumbersText: input.inProgressLine?.serialNumbers?.join("\n") ?? "",
      trackingDetails: toReceivingTrackingDetails(
        input.inProgressItem?.trackingDetails,
        input.inProgressLine,
      ),
      notes: input.inProgressLine?.notes ?? "",
      purchaseToBaseFactor,
    };
  }

  private toTransferDetailLine(
    item: InventoryTransferItem,
    product: Product | undefined,
    unitById: Map<string, Unit>,
    defaultLocationId: string,
    group?: TransferTraceabilityGroup,
    readOnly = false,
  ): ReceivingDocumentLine {
    const orderedQuantity =
      group?.dispatchedQuantity ??
      (item.dispatchedQuantity > 0 ? item.dispatchedQuantity : item.requestedQuantity);
    const baseUnit = product ? unitById.get(product.baseUnitId) : undefined;
    const acceptedPreviously = group?.acceptedPreviously ?? item.receivedQuantity;
    const pendingQuantity = Math.max(0, orderedQuantity - acceptedPreviously);
    return {
      id: group ? `${item.id}:${group.key}` : item.id,
      sourceLineId: item.id,
      productId: item.productId,
      productName: product?.name ?? "Producto no disponible",
      sku: product?.sku ?? "-",
      unitId: product?.baseUnitId ?? "",
      unitName: baseUnit?.name ?? "Unidad",
      unitAllowsDecimals: baseUnit?.allowsDecimals ?? false,
      baseUnitId: product?.baseUnitId ?? "",
      baseUnitName: baseUnit?.name ?? "Unidad base",
      baseUnitAllowsDecimals: baseUnit?.allowsDecimals ?? false,
      orderedQuantity,
      acceptedPreviously,
      receivedNow: group?.serialNumbers ? 0 : pendingQuantity,
      pendingQuantity,
      locationId: defaultLocationId,
      tracking: product?.tracking ?? { stock: false, lot: false, expiration: false, serial: false },
      lotNumber: group?.lotNumber ?? "",
      expirationDate: group?.expirationDate ?? "",
      serialNumbersText:
        (readOnly ? group?.dispatchedSerialNumbers : group?.serialNumbers)?.join("\n") ?? "",
      trackingDetails: [],
      notes: "",
      purchaseToBaseFactor: 1,
    };
  }

  // El id llega desde la URL/estado del cliente: `getByIdScoped` trata una orden de otro tenant
  // igual que una inexistente. La validacion de sucursal (User.allowedBranchIds) corre siempre
  // aca, incondicional -- antes de este fix dependia de que el caller pasara `activeBranchId`,
  // que era opcional y por lo tanto evitable.
  private async requirePurchaseOrder(
    tenantId: string,
    user: User,
    id: string,
  ): Promise<PurchaseOrder> {
    const order = await this.repositories.purchaseOrders.getByIdScoped(tenantId, id);
    if (!order) throw new ReceivingServiceError("Documento de compra no encontrado.");
    await ensureUserCanOperateBranch(this.repositories, user, order.branchId);
    return order;
  }

  private async ensureInProgressReceipt(
    order: PurchaseOrder,
    actorUserId: string,
  ): Promise<Receipt> {
    const receipts = await this.repositories.receipts.listByTenant(order.tenantId);
    const existing = receipts.find(
      (receipt) =>
        receipt.purchaseOrderId === order.id && receipt.status === ReceiptStatus.in_progress,
    );
    if (existing) return existing;
    return this.repositories.receipts.create({
      tenantId: order.tenantId,
      branchId: order.branchId,
      number: await this.nextReceiptNumber(order.tenantId),
      purchaseOrderId: order.id,
      supplierId: order.supplierId,
      status: ReceiptStatus.in_progress,
      receivedByUserId: actorUserId,
    });
  }

  private async nextReceiptNumber(tenantId: string) {
    const receipts = await this.repositories.receipts.listByTenant(tenantId);
    const next =
      receipts.reduce((max, receipt) => {
        const match = /^REC-(\d+)$/.exec(receipt.number);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1;
    return `REC-${String(next).padStart(3, "0")}`;
  }

  private async getCapabilities(tenantId: string): Promise<BusinessCapabilitiesConfig> {
    const capabilities = await this.repositories.businessConfig.getCapabilities(tenantId);
    if (!capabilities)
      throw new ReceivingServiceError("No hay configuracion operativa para este tenant.");
    return capabilities;
  }

  private async getInventorySettings(order: PurchaseOrder) {
    const entries = await Promise.all(
      (order.items ?? []).map(
        async (item) =>
          [
            item.productId,
            await this.repositories.inventory.getProductInventorySettings(
              item.productId,
              order.branchId,
            ),
          ] as const,
      ),
    );
    return new Map(entries);
  }
}

interface TransferTraceabilityGroup {
  key: string;
  lotNumber: string;
  expirationDate: string;
  dispatchedQuantity: number;
  acceptedPreviously: number;
  serialNumbers?: string[];
  dispatchedSerialNumbers?: string[];
}

function buildTransferTraceabilityGroups(
  outgoing: InventoryMovement[],
  incoming: InventoryMovement[],
  lots: StockLot[],
  serials: SerialNumber[],
  product?: Product,
): TransferTraceabilityGroup[] {
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const serialById = new Map(serials.map((serial) => [serial.id, serial]));
  const keyFor = (movement: InventoryMovement) => {
    if (!product?.tracking.lot) return "";
    const lot = movement.lotId ? lotById.get(movement.lotId) : undefined;
    if (
      !lot ||
      lot.tenantId !== movement.tenantId ||
      lot.branchId !== movement.branchId ||
      lot.productId !== movement.productId
    ) {
      throw new ReceivingServiceError("No se puede verificar el lote despachado del traslado.");
    }
    return JSON.stringify([lot.lotNumber, lot.expirationDate?.slice(0, 10) ?? ""]);
  };
  const receivedByKey = new Map<string, InventoryMovement[]>();
  incoming.forEach((movement) => {
    const key = keyFor(movement);
    receivedByKey.set(key, [...(receivedByKey.get(key) ?? []), movement]);
  });
  const sentByKey = new Map<string, InventoryMovement[]>();
  outgoing.forEach((movement) => {
    const key = keyFor(movement);
    sentByKey.set(key, [...(sentByKey.get(key) ?? []), movement]);
  });
  if ([...receivedByKey.keys()].some((key) => !sentByKey.has(key))) {
    throw new ReceivingServiceError("La trazabilidad recibida no corresponde al despacho.");
  }
  return [...sentByKey.entries()].map(([key, sent]) => {
    const received = receivedByKey.get(key) ?? [];
    const dispatchedQuantity = sent.reduce((sum, movement) => sum + movement.quantity, 0);
    const acceptedPreviously = received.reduce((sum, movement) => sum + movement.quantity, 0);
    if (acceptedPreviously > dispatchedQuantity) {
      throw new ReceivingServiceError("La recepción supera la cantidad despachada.");
    }
    const lot = sent[0].lotId ? lotById.get(sent[0].lotId) : undefined;
    let pendingSerials: string[] | undefined;
    let dispatchedSerialNumbers: string[] | undefined;
    if (product?.tracking.serial) {
      const receivedIds = new Set(received.map((movement) => movement.serialNumberId));
      const sentIds = sent.map((movement) => movement.serialNumberId);
      if (
        sentIds.some((id) => !id) ||
        new Set(sentIds).size !== sentIds.length ||
        received.some(
          (movement) => !movement.serialNumberId || !sentIds.includes(movement.serialNumberId),
        )
      ) {
        throw new ReceivingServiceError("Las series recibidas no coinciden con el despacho.");
      }
      dispatchedSerialNumbers = sent
        .map((movement) => {
          const serial = movement.serialNumberId
            ? serialById.get(movement.serialNumberId)
            : undefined;
          if (
            !serial ||
            serial.tenantId !== movement.tenantId ||
            serial.productId !== movement.productId ||
            movement.quantity !== 1
          ) {
            throw new ReceivingServiceError("No se puede verificar una serie despachada.");
          }
          return serial.serialNumber;
        })
        .sort((a, b) => a.localeCompare(b));
      pendingSerials = sent
        .filter((movement) => !receivedIds.has(movement.serialNumberId))
        .map((movement) => serialById.get(movement.serialNumberId!)!.serialNumber)
        .sort((a, b) => a.localeCompare(b));
      if (pendingSerials.length !== dispatchedQuantity - acceptedPreviously) {
        throw new ReceivingServiceError("La cantidad pendiente no coincide con sus series.");
      }
    }
    return {
      key,
      lotNumber: lot?.lotNumber ?? "",
      expirationDate: lot?.expirationDate?.slice(0, 10) ?? "",
      dispatchedQuantity,
      acceptedPreviously,
      serialNumbers: pendingSerials,
      dispatchedSerialNumbers,
    };
  });
}

function getReceivingConfirmationFingerprint(
  input: ConfirmReceivingInput,
  order: Pick<PurchaseOrder, "tenantId" | "branchId" | "id">,
): string {
  const lines = input.lines
    .map((line) => ({
      productId: line.productId,
      acceptedQuantity: getAcceptedNow(line),
      incidentQuantity: getRejectedNow(line, input.incidents),
      locationId: line.locationId || null,
      lotNumber: line.lotNumber.trim() || null,
      expirationDate: line.expirationDate || null,
      serialNumbers: parseSerialNumbers(line.serialNumbersText).sort(),
      purchaseToBaseFactor: line.purchaseToBaseFactor,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const incidents = input.incidents
    .filter((incident) => incident.editable)
    .map((incident) => ({
      productId: incident.productId ?? null,
      incidentTypeId: incident.incidentTypeId,
      quantityAffected: incident.quantityAffected ?? 0,
      description: incident.description.trim(),
      evidence: incident.evidence,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({
    tenantId: order.tenantId,
    branchId: order.branchId,
    purchaseOrderId: order.id,
    lines,
    incidents,
  });
}

// Nunca se muestra un UUID como nombre de responsable.
const UNKNOWN_RESPONSIBLE_LABEL = "No disponible";

function getApiIncidentTypeOptions() {
  return Object.entries(RECEIPT_INCIDENT_TYPE_LABELS).map(([id, name]) => ({ id, name }));
}

function toApiIncidentRows(
  incidents: ReceiptIncidentRecord[],
  receipt: ReceiptRecord,
  userNameById: Map<string, string>,
): ReceivingDocumentIncident[] {
  return incidents.map((incident) => {
    const item = incident.goodsReceiptItemId
      ? receipt.items.find((candidate) => candidate.line.id === incident.goodsReceiptItemId)
      : undefined;
    return {
      id: incident.id,
      receiptId: incident.goodsReceiptId,
      ...(incident.goodsReceiptItemId
        ? {
            goodsReceiptItemId: incident.goodsReceiptItemId,
            receiptLineId: incident.goodsReceiptItemId,
          }
        : {}),
      ...(item?.line.productId ? { productId: item.line.productId } : {}),
      productName: item?.productNameSnapshot ?? "Incidencia general",
      sku: item?.productSkuSnapshot ?? "-",
      incidentTypeId: incident.incidentType,
      incidentType: incident.incidentType,
      status: incident.status,
      incidentTypeName: RECEIPT_INCIDENT_TYPE_LABELS[incident.incidentType],
      ...(incident.quantityAffected !== undefined
        ? { quantityAffected: incident.quantityAffected }
        : {}),
      description: incident.notes,
      evidence: [],
      createdAt: incident.createdAt,
      createdByUserId: incident.createdByUserId,
      createdByName: userNameById.get(incident.createdByUserId) ?? UNKNOWN_RESPONSIBLE_LABEL,
      receiptNumber: receipt.receipt.number,
      editable: false,
    };
  });
}

function toReceivingTrackingDetails(
  details: ReceiptItemRecord["trackingDetails"] | undefined,
  legacyLine?: ReceiptLine,
): ReceivingTrackingDetail[] {
  if (details) {
    return details.map((detail, index) => ({
      id: `${legacyLine?.id ?? "receipt-item"}-tracking-${index}`,
      baseQuantity: detail.baseQuantity,
      lotNumber: detail.lotNumber ?? "",
      expirationDate: detail.expirationDate?.slice(0, 10) ?? "",
      serialNumbersText: detail.serialNumbers.join("\n"),
    }));
  }
  if (
    !legacyLine ||
    (!legacyLine.lotNumber &&
      !legacyLine.expirationDate &&
      (legacyLine.serialNumbers?.length ?? 0) === 0)
  ) {
    return [];
  }
  return [
    {
      id: `${legacyLine.id}-tracking-0`,
      baseQuantity: legacyLine.inventoryQuantity ?? legacyLine.receivedQuantity,
      lotNumber: legacyLine.lotNumber ?? "",
      expirationDate: legacyLine.expirationDate?.slice(0, 10) ?? "",
      serialNumbersText: legacyLine.serialNumbers?.join("\n") ?? "",
    },
  ];
}

/** Bloqueo conocido: requiere un cambio de backend (ver reporte); no se disfraza en el frontend. */
export const LOCATIONS_DISABLED_RECEIPT_BLOCK_MESSAGE =
  "la recepcion de productos con control de inventario no esta disponible con las ubicaciones " +
  "desactivadas hasta que el servidor acepte recepciones sin ubicacion.";

export function validateApiDraftLines(
  lines: ReceivingDocumentLine[],
  detail: Pick<ReceivingDocumentContent, "lines" | "capabilities">,
  operationDate = getLocalCalendarDate(),
) {
  const errors: string[] = [];
  const serialOwner = new Map<string, string>();
  let includedLines = 0;

  for (const line of lines) {
    const canonicalLine = detail.lines.find(
      (candidate) =>
        candidate.id === line.id &&
        candidate.sourceLineId === line.sourceLineId &&
        candidate.productId === line.productId,
    );
    if (!canonicalLine) {
      errors.push("Una línea recibida no pertenece al documento actual.");
      continue;
    }
    const receivedQuantity = toFiniteNumber(line.receivedNow);
    if (line.receivedNow === "" || receivedQuantity === 0) continue;
    includedLines += 1;
    if (
      receivedQuantity < 0 ||
      !isQuantityCompatibleWithUnit(line.receivedNow, line.unitAllowsDecimals)
    ) {
      errors.push(
        line.unitAllowsDecimals
          ? `${line.productName}: la cantidad recibida debe ser positiva y admitir hasta ${QUANTITY_DECIMAL_PLACES} decimales.`
          : `${line.productName}: la cantidad recibida debe ser un entero positivo.`,
      );
    }
    const remaining = Math.max(0, line.orderedQuantity - line.acceptedPreviously);
    if (receivedQuantity > remaining) {
      errors.push(`${line.productName}: la cantidad recibida no puede superar ${remaining}.`);
    }
    if (receivedQuantity > MAX_SAFE_INVENTORY_QUANTITY) {
      errors.push(`${line.productName}: la cantidad recibida supera el máximo permitido.`);
    }
    if (line.tracking.stock && detail.capabilities.supportsMultipleLocations && !line.locationId) {
      errors.push(`${line.productName}: configura una ubicación operativa activa.`);
    } else if (
      line.tracking.stock &&
      detail.capabilities.supportsMultipleLocations &&
      line.locationId !== canonicalLine.locationId
    ) {
      errors.push(`${line.productName}: la ubicación no coincide con la operativa de la línea.`);
    } else if (line.tracking.stock && !detail.capabilities.supportsMultipleLocations) {
      // GoodsReceiptService.resolveItems exige locationId para productos con control de inventario
      // aun con las ubicaciones apagadas, y Inventario operaria ese UUID como un balance fisico que
      // las ventas (balance sin ubicacion) no ven. No se envia null (400) ni una ubicacion inventada.
      errors.push(`${line.productName}: ${LOCATIONS_DISABLED_RECEIPT_BLOCK_MESSAGE}`);
    }

    const expectedBaseQuantity = roundQuantity(toBaseQuantity(line, receivedQuantity));
    const requiresTrackingDetails = line.tracking.lot || line.tracking.serial;
    if (!requiresTrackingDetails) {
      if (line.trackingDetails.length > 0) {
        errors.push(`${line.productName}: el producto no utiliza detalle de lote o serie.`);
      }
      continue;
    }
    if (line.trackingDetails.length === 0) {
      errors.push(`${line.productName}: agrega al menos un detalle de trazabilidad.`);
      continue;
    }

    const lots = new Set<string>();
    let trackedBaseQuantity = 0;
    line.trackingDetails.forEach((tracking, index) => {
      const label = `${line.productName}, detalle ${index + 1}`;
      const baseQuantity = toFiniteNumber(tracking.baseQuantity);
      if (
        tracking.baseQuantity === "" ||
        baseQuantity <= 0 ||
        !isQuantityCompatibleWithUnit(
          tracking.baseQuantity,
          line.baseUnitAllowsDecimals && !line.tracking.serial,
        )
      ) {
        errors.push(
          `${label}: la cantidad base debe ser positiva y admitir hasta ${QUANTITY_DECIMAL_PLACES} decimales.`,
        );
      }
      trackedBaseQuantity += baseQuantity;

      const lotNumber = tracking.lotNumber.trim();
      if (line.tracking.lot) {
        if (!lotNumber) errors.push(`${label}: ingresa el número de lote.`);
        if (lotNumber && lots.has(lotNumber)) {
          errors.push(`${line.productName}: un lote no puede repetirse entre detalles.`);
        }
        if (lotNumber) lots.add(lotNumber);
      } else if (lotNumber || tracking.expirationDate) {
        errors.push(`${label}: el producto no utiliza trazabilidad por lote.`);
      }

      if (line.tracking.expiration) {
        if (!tracking.expirationDate) {
          errors.push(`${label}: ingresa la fecha de vencimiento.`);
        } else if (isExpirationBeforeOperationDate(tracking.expirationDate, operationDate)) {
          errors.push(`${label}: ${EXPIRATION_BEFORE_ENTRY_MESSAGE}`);
        }
      } else if (tracking.expirationDate) {
        errors.push(`${label}: el producto no utiliza vencimiento.`);
      }

      const serials = parseSerialNumbers(tracking.serialNumbersText);
      if (line.tracking.serial) {
        if (!Number.isInteger(baseQuantity) || serials.length !== baseQuantity) {
          errors.push(
            `${label}: la cantidad base debe ser entera y coincidir con sus números de serie.`,
          );
        }
        const localSerials = new Set<string>();
        serials.forEach((serial) => {
          if (serial.length > 100) {
            errors.push(`${label}: cada número de serie admite hasta 100 caracteres.`);
          }
          if (localSerials.has(serial)) {
            errors.push(`${label}: los números de serie no pueden repetirse.`);
          }
          localSerials.add(serial);
          const owner = serialOwner.get(serial);
          if (owner && owner !== label) {
            errors.push(
              `${line.productName}: el número de serie ${serial} ya aparece en otra línea o detalle.`,
            );
          } else {
            serialOwner.set(serial, label);
          }
        });
      } else if (serials.length > 0) {
        errors.push(`${label}: el producto no utiliza números de serie.`);
      }
    });
    if (roundQuantity(trackedBaseQuantity) !== expectedBaseQuantity) {
      errors.push(
        `${line.productName}: la suma de cantidades base debe ser ${expectedBaseQuantity}.`,
      );
    }
  }
  if (includedLines === 0) {
    errors.push("Ingresa al menos una cantidad recibida para continuar.");
  }
  return errors;
}

function roundQuantity(value: number) {
  return Number(value.toFixed(QUANTITY_DECIMAL_PLACES));
}

function toReceiptIncidentInputs(
  input: SaveReceivingProgressInput,
  detail: Pick<ReceivingDocumentContent, "lines">,
  actorUserId: string,
) {
  const validProductIds = new Set(detail.lines.map((line) => line.productId));
  return input.incidents
    .filter(
      (incident) =>
        incident.editable && incident.productId && validProductIds.has(incident.productId),
    )
    .map((incident) => ({
      ...(!incident.id.startsWith("draft-") ? { id: incident.id } : {}),
      ...(incident.createdAt ? { createdAt: incident.createdAt } : {}),
      productId: incident.productId,
      incidentTypeId: incident.incidentTypeId,
      description: incident.description.trim(),
      quantityAffected: incident.quantityAffected,
      evidence: incident.evidence,
      createdByUserId: incident.id.startsWith("draft-")
        ? actorUserId
        : incident.createdByUserId || actorUserId,
    }));
}

export function validateLines(
  lines: ReceivingDocumentLine[],
  incidents: ReceivingDocumentIncident[],
  detail: ReceivingLineValidationContext,
  operationDate = getLocalCalendarDate(),
) {
  if (detail.dataSource === "api" && detail.document.type === "purchase_order") {
    return validateApiDraftLines(lines, detail, operationDate);
  }
  const unitAllowsDecimals = new Map(
    detail.lines.map((line) => [line.id, line.unitAllowsDecimals]),
  );
  return lines
    .flatMap((line) => {
      const errors: string[] = [];
      const acceptedNow = toFiniteNumber(line.receivedNow);
      const incidentQuantity = getRejectedNow(line, incidents);
      const allowsDecimals = unitAllowsDecimals.get(line.id) ?? false;
      if (
        line.receivedNow !== "" &&
        !isQuantityCompatibleWithUnit(line.receivedNow, allowsDecimals)
      ) {
        errors.push(
          allowsDecimals
            ? `${line.productName}: la cantidad admite hasta ${QUANTITY_DECIMAL_PLACES} decimales.`
            : `${line.productName}: la unidad no admite fracciones.`,
        );
      }
      if (!isQuantityCompatibleWithUnit(incidentQuantity, allowsDecimals)) {
        errors.push(
          allowsDecimals
            ? `${line.productName}: la incidencia admite hasta ${QUANTITY_DECIMAL_PLACES} decimales.`
            : `${line.productName}: la unidad no admite incidencias fraccionarias.`,
        );
      }
      if (
        detail.capabilities.supportsMultipleLocations &&
        detail.capabilities.supportsInventory &&
        line.tracking.stock &&
        acceptedNow > 0 &&
        !line.locationId
      ) {
        errors.push(`${line.productName}: selecciona ubicacion.`);
      }
      if (
        detail.capabilities.supportsMultipleLocations &&
        line.tracking.stock &&
        acceptedNow > 0 &&
        line.locationId !== detail.lines.find((candidate) => candidate.id === line.id)?.locationId
      ) {
        errors.push(`${line.productName}: la ubicacion no coincide con la operativa de la linea.`);
      }
      if (
        !detail.capabilities.supportsMultipleLocations &&
        line.tracking.stock &&
        acceptedNow > 0 &&
        line.locationId
      ) {
        errors.push(`${line.productName}: la recepcion no debe enviar una ubicacion fisica.`);
      }
      if (
        line.tracking.lot &&
        detail.capabilities.supportsLots &&
        acceptedNow > 0 &&
        !line.lotNumber.trim()
      ) {
        errors.push(`${line.productName}: lote requerido.`);
      }
      if (
        line.tracking.expiration &&
        detail.capabilities.supportsExpiration &&
        acceptedNow > 0 &&
        !line.expirationDate
      ) {
        errors.push(`${line.productName}: fecha de vencimiento requerida.`);
      }
      if (
        line.tracking.expiration &&
        detail.capabilities.supportsExpiration &&
        acceptedNow > 0 &&
        line.expirationDate &&
        isExpirationBeforeOperationDate(line.expirationDate, operationDate)
      ) {
        errors.push(`${line.productName}: ${EXPIRATION_BEFORE_ENTRY_MESSAGE}`);
      }
      if (line.tracking.serial && detail.capabilities.supportsSerials && acceptedNow > 0) {
        const serials = parseSerialNumbers(line.serialNumbersText);
        const expectedSerials = toBaseQuantity(line, acceptedNow);
        if (serials.length !== expectedSerials) {
          errors.push(`${line.productName}: registra ${expectedSerials} numeros de serie.`);
        }
        if (new Set(serials).size !== serials.length) {
          errors.push(`${line.productName}: los numeros de serie no pueden repetirse.`);
        }
      }
      return errors;
    })
    .concat(validateIncidentQuantities(lines, incidents, detail));
}

export function validateIncidentQuantities(
  lines: ReceivingDocumentLine[],
  incidents: ReceivingDocumentIncident[],
  detail?: ReceivingIncidentValidationContext,
) {
  const lineByProductId = new Map((detail?.lines ?? lines).map((line) => [line.productId, line]));
  const validIncidentTypeIds = detail
    ? new Set(detail.incidentTypes.map((type) => type.id))
    : undefined;
  const errors: string[] = [];
  for (const incident of incidents.filter((item) => item.editable)) {
    const line = incident.productId ? lineByProductId.get(incident.productId) : undefined;
    if (!line) {
      errors.push("Selecciona un producto valido para cada incidencia.");
      continue;
    }
    if (
      !incident.incidentTypeId ||
      (validIncidentTypeIds && !validIncidentTypeIds.has(incident.incidentTypeId))
    ) {
      errors.push(`${line.productName}: selecciona un tipo de incidencia valido.`);
    }
    if (!incident.description.trim()) {
      errors.push(`${line.productName}: agrega la observacion de la incidencia.`);
    }
    if (incident.description.length > TEXT_LIMITS.notes) {
      errors.push(`${line.productName}: la observacion admite hasta 500 caracteres.`);
    }
    const quantity = incident.quantityAffected ?? 0;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`${line.productName}: la cantidad de la incidencia debe ser mayor que cero.`);
    }
    if (quantity > MAX_SAFE_INVENTORY_QUANTITY) {
      errors.push(`${line.productName}: la cantidad de la incidencia no puede superar 999,999.99.`);
    }
    if (!isQuantityCompatibleWithUnit(quantity, line.unitAllowsDecimals)) {
      errors.push(
        line.unitAllowsDecimals
          ? `${line.productName}: la incidencia admite hasta ${QUANTITY_DECIMAL_PLACES} decimales.`
          : `${line.productName}: la unidad no admite incidencias fraccionarias.`,
      );
    }
  }
  for (const line of lines) {
    const incidentQuantity = getRejectedNow(line, incidents);
    const acceptedNow = toFiniteNumber(line.receivedNow);
    const remainingBefore = Math.max(0, line.orderedQuantity - line.acceptedPreviously);
    if (
      line.receivedNow !== "" &&
      (typeof line.receivedNow !== "number" || !Number.isFinite(line.receivedNow))
    ) {
      errors.push(`${line.productName}: aceptado ahora no es valido.`);
    }
    if (acceptedNow > MAX_SAFE_INVENTORY_QUANTITY) {
      errors.push(`${line.productName}: la cantidad no puede superar 999,999.99.`);
    }
    if ((line.lotNumber?.length ?? 0) > TEXT_LIMITS.lotNumber) {
      errors.push(`${line.productName}: el lote admite hasta 50 caracteres.`);
    }
    if ((line.serialNumbersText?.length ?? 0) > TEXT_LIMITS.serialNumbers) {
      errors.push(`${line.productName}: las series admiten hasta 5,000 caracteres.`);
    }
    if ((line.notes?.length ?? 0) > TEXT_LIMITS.notes) {
      errors.push(`${line.productName}: las notas admiten hasta 500 caracteres.`);
    }
    if (acceptedNow < 0 || acceptedNow > remainingBefore) {
      errors.push(`${line.productName}: aceptado ahora debe estar entre 0 y ${remainingBefore}.`);
    }
    if (acceptedNow + incidentQuantity > remainingBefore) {
      const available = Math.max(0, remainingBefore - Math.min(acceptedNow, incidentQuantity));
      errors.push(
        `${line.productName}: solo quedan ${available} unidades disponibles para registrar entre aceptadas e incidencias.`,
      );
    }
  }
  return errors;
}

export function isReceiptHistoryIncomplete(page: number, totalPages: number): boolean {
  return page < totalPages;
}

export function isApiReceivingReadOnly(
  status: PurchaseOrderStatus,
  _hasUnsupportedMultiLot: boolean,
  receiptHistoryIncomplete: boolean,
): boolean {
  return !isApiReceivablePurchaseOrder(status) || receiptHistoryIncomplete;
}

export async function persistApiDraftWithHistoryGuard(
  receipts: Pick<
    ReceiptRepository,
    "getPageScoped" | "getRecordByIdScoped" | "createDraftScoped" | "updateDraftScoped"
  >,
  tenantId: string,
  branchId: string,
  purchaseOrderId: string,
  input: Omit<ReceiptDraftInput, "purchaseOrderId">,
): Promise<ReceiptRecord> {
  const [draftPage, confirmedReceiptPage] = await Promise.all([
    receipts.getPageScoped(tenantId, {
      branchId,
      purchaseOrderId,
      status: "draft",
      page: 1,
      pageSize: 2,
    }),
    receipts.getPageScoped(tenantId, {
      branchId,
      purchaseOrderId,
      status: "confirmed",
      page: 1,
      pageSize: 100,
    }),
  ]);
  if (isReceiptHistoryIncomplete(confirmedReceiptPage.page, confirmedReceiptPage.totalPages)) {
    throw new ReceivingServiceError(
      "No se puede modificar esta recepción porque el historial de recepciones anteriores está incompleto. Consulta el historial completo antes de editar.",
    );
  }
  if (draftPage.totalItems > 1) {
    throw new ReceivingServiceError(
      "La orden tiene varios borradores de recepción. Resuelve el conflicto antes de editar.",
    );
  }
  const discoveredDraft = draftPage.items[0];
  if (discoveredDraft) {
    return updateCanonicalDraft(
      receipts,
      tenantId,
      purchaseOrderId,
      discoveredDraft.receipt.id,
      input,
    );
  }
  return receipts.createDraftScoped({
    ...input,
    purchaseOrderId,
  });
}

export async function updateCanonicalDraft(
  receipts: Pick<ReceiptRepository, "getRecordByIdScoped" | "updateDraftScoped">,
  tenantId: string,
  purchaseOrderId: string,
  receiptId: string,
  input: Omit<ReceiptDraftInput, "purchaseOrderId">,
): Promise<ReceiptRecord> {
  const current = await receipts.getRecordByIdScoped(tenantId, receiptId);
  if (
    !current ||
    current.receipt.purchaseOrderId !== purchaseOrderId ||
    current.receipt.status !== ReceiptStatus.in_progress
  ) {
    throw new ReceivingServiceError("No se encontró el borrador de recepción solicitado.");
  }
  return receipts.updateDraftScoped(current.receipt.id, input);
}

/**
 * Compatibilidad nominal con el verificador 7A1 protegido. El editor 7A2 ya conserva
 * `trackingDetails[]`, por lo que esta validación dejó de imponer una restricción multi-lote.
 */
export function assertSingleLotDraftEditable(record: ReceiptRecord): void {
  void record;
}

/** @deprecated Usa `updateCanonicalDraft`; 7A2 admite borradores multi-lote. */
export const updateCanonicalSingleLotDraft = updateCanonicalDraft;

export function toBaseQuantity(
  line: Pick<ReceivingDocumentLine, "purchaseToBaseFactor">,
  quantity: number,
) {
  return quantity * line.purchaseToBaseFactor;
}

function toApiDraftItems(lines: ReceivingDocumentLine[]): ReceiptDraftItemInput[] {
  return lines.flatMap((line) => {
    const receivedQuantity = toFiniteNumber(line.receivedNow);
    if (receivedQuantity <= 0) return [];
    const usesTracking = line.tracking.lot || line.tracking.expiration || line.tracking.serial;
    return [
      {
        purchaseOrderItemId: line.sourceLineId,
        receivedQuantity,
        locationId: line.locationId || undefined,
        trackingDetails: usesTracking
          ? line.trackingDetails.map((detail) => ({
              baseQuantity: toFiniteNumber(detail.baseQuantity),
              lotNumber: detail.lotNumber.trim() || undefined,
              expirationDate: detail.expirationDate || undefined,
              serialNumbers: parseSerialNumbers(detail.serialNumbersText),
            }))
          : [],
      },
    ];
  });
}

function toReceiptLineInput(line: ReceivingDocumentLine, incidents: ReceivingDocumentIncident[]) {
  const rejectedQuantity = getRejectedNow(line, incidents);
  const receivedQuantity = toFiniteNumber(line.receivedNow);
  const pending = Math.max(0, line.orderedQuantity - line.acceptedPreviously - receivedQuantity);
  return {
    ...(line.receiptLineId ? { id: line.receiptLineId } : {}),
    productId: line.productId,
    orderedQuantity: line.orderedQuantity,
    receivedQuantity,
    inventoryQuantity: toBaseQuantity(line, receivedQuantity),
    rejectedQuantity,
    status: getLineStatus(receivedQuantity, rejectedQuantity, pending),
    locationId: line.locationId || undefined,
    lotId: line.lotNumber.trim() || undefined,
    lotNumber: line.lotNumber.trim() || undefined,
    expirationDate: line.expirationDate || undefined,
    serialNumbers: parseSerialNumbers(line.serialNumbersText),
    notes: line.notes.trim() || undefined,
  };
}

function getLineStatus(
  receivedQuantity: number,
  rejectedQuantity: number,
  pendingQuantity: number,
) {
  if (rejectedQuantity > 0) return ReceiptLineStatus.incident;
  if (pendingQuantity <= 0) return ReceiptLineStatus.complete;
  if (receivedQuantity > 0) return ReceiptLineStatus.partial;
  return ReceiptLineStatus.pending;
}

export function parseSerialNumbers(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toIncidentRows(
  incidents: ReceiptIncident[],
  incidentTypes: Array<{ id: string; name: string }>,
  lineByReceiptLineId: Map<string, ReceiptLine>,
  productById: Map<string, Product>,
  receiptById: Map<string, Receipt>,
  userNameById: Map<string, string>,
  inProgressReceiptId?: string,
): ReceivingDocumentIncident[] {
  const incidentTypeById = new Map(incidentTypes.map((type) => [type.id, type]));
  return incidents
    .map((incident) => {
      const line = incident.receiptLineId
        ? lineByReceiptLineId.get(incident.receiptLineId)
        : undefined;
      const product = line ? productById.get(line.productId) : undefined;
      return {
        id: incident.id,
        receiptId: incident.receiptId,
        ...(incident.receiptLineId ? { receiptLineId: incident.receiptLineId } : {}),
        ...(line?.productId ? { productId: line.productId } : {}),
        productName: product?.name ?? "Producto no disponible",
        sku: product?.sku ?? "-",
        incidentTypeId: incident.incidentTypeId,
        incidentTypeName: incidentTypeById.get(incident.incidentTypeId)?.name ?? "Tipo archivado",
        quantityAffected: incident.quantityAffected,
        description: incident.description,
        evidence: incident.evidence ?? [],
        createdAt: incident.createdAt,
        createdByUserId: incident.createdByUserId,
        createdByName: userNameById.get(incident.createdByUserId) ?? UNKNOWN_RESPONSIBLE_LABEL,
        receiptNumber: receiptById.get(incident.receiptId)?.number ?? incident.receiptId,
        editable: incident.receiptId === inProgressReceiptId,
      };
    })
    .sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
}

function buildPreviousReceipts(input: {
  receipts: Receipt[];
  receiptLines: ReceiptLine[];
  incidents: ReceiptIncident[];
  incidentTypes: Array<{ id: string; name: string }>;
  productById: Map<string, Product>;
  unitById: Map<string, Unit>;
  locationNameById: Map<string, string>;
  userNameById: Map<string, string>;
  orderItems: PurchaseOrderItem[];
  orderNumber: string;
  orderedTotal: number;
}) {
  const sortedReceipts = [...input.receipts].sort(
    (left, right) =>
      new Date(left.receivedAt ?? left.updatedAt).getTime() -
      new Date(right.receivedAt ?? right.updatedAt).getTime(),
  );
  const receiptById = new Map(sortedReceipts.map((receipt) => [receipt.id, receipt]));
  const lineByReceiptLineId = new Map(input.receiptLines.map((line) => [line.id, line]));
  const orderItemByProductId = new Map(input.orderItems.map((item) => [item.productId, item]));
  const acceptedByProductId = new Map<string, number>();
  let cumulativeAccepted = 0;

  return sortedReceipts.map((receipt, receiptIndex) => {
    const lines = input.receiptLines.filter((line) => line.receiptId === receipt.id);
    const receiptIncidents = input.incidents.filter(
      (incident) => incident.receiptId === receipt.id,
    );
    const acceptedQuantity = lines.reduce((sum, line) => sum + line.receivedQuantity, 0);
    cumulativeAccepted += acceptedQuantity;
    return {
      id: receipt.id,
      sequenceNumber: receiptIndex + 1,
      orderNumber: input.orderNumber,
      number: receipt.number,
      receivedAt: receipt.receivedAt ?? receipt.updatedAt,
      responsibleName:
        (receipt.receivedByUserId && input.userNameById.get(receipt.receivedByUserId)) ||
        UNKNOWN_RESPONSIBLE_LABEL,
      statusLabel: receipt.status === ReceiptStatus.received ? "Recibida" : "Parcial",
      acceptedQuantity,
      incidentQuantity: receiptIncidents.reduce(
        (sum, incident) => sum + (incident.quantityAffected ?? 0),
        0,
      ),
      pendingAfter: Math.max(0, input.orderedTotal - cumulativeAccepted),
      lines: lines.map((line) => {
        const product = input.productById.get(line.productId);
        const orderItem = orderItemByProductId.get(line.productId);
        const unit = orderItem ? input.unitById.get(orderItem.unitId) : undefined;
        const orderedQuantity = line.orderedQuantity ?? orderItem?.quantity ?? 0;
        const previousAccepted = acceptedByProductId.get(line.productId) ?? 0;
        const incidentQuantity = receiptIncidents
          .filter((incident) => incident.receiptLineId === line.id)
          .reduce((sum, incident) => sum + (incident.quantityAffected ?? 0), 0);
        const pendingAfter = Math.max(
          0,
          orderedQuantity - previousAccepted - line.receivedQuantity,
        );
        acceptedByProductId.set(line.productId, previousAccepted + line.receivedQuantity);
        return {
          id: line.id,
          productName: product?.name ?? "Producto no disponible",
          sku: product?.sku ?? "-",
          acceptedQuantity: line.receivedQuantity,
          orderedQuantity,
          incidentQuantity,
          pendingAfter,
          unitName: unit?.name ?? "Unidad",
          locationName:
            (line.locationId && input.locationNameById.get(line.locationId)) ?? "No especificada",
          lotNumber: line.lotNumber ?? line.lotId ?? "",
          expirationDate: line.expirationDate ?? "",
          serialNumbers: line.serialNumbers ?? [],
        };
      }),
      incidents: toIncidentRows(
        receiptIncidents,
        input.incidentTypes,
        lineByReceiptLineId,
        input.productById,
        receiptById,
        input.userNameById,
      ),
    };
  });
}

export function getRejectedNow(
  line: ReceivingDocumentLine,
  incidents: ReceivingDocumentIncident[],
) {
  // Mock: borradores editables. API: solo incidencias OPEN (las resueltas ya no son mercancia
  // afectada: se aceptaron como reemplazo).
  return incidents
    .filter(
      (incident) =>
        incident.productId === line.productId && (incident.editable || incident.status === "open"),
    )
    .reduce((sum, incident) => sum + (incident.quantityAffected ?? 0), 0);
}

/** Cantidad todavia asignable a incidencias: pedido - aceptado - ya afectado por incidencias OPEN. */
export function getIncidentCapacity(
  line: ReceivingDocumentLine,
  incidents: ReceivingDocumentIncident[],
) {
  return Math.max(
    0,
    roundQuantity(
      line.orderedQuantity -
        line.acceptedPreviously -
        toFiniteNumber(line.receivedNow) -
        getRejectedNow(line, incidents),
    ),
  );
}

export function getAcceptedNow(line: ReceivingDocumentLine) {
  return Math.max(0, toFiniteNumber(line.receivedNow));
}

export const STALE_LOCATION_LOCKED_DRAFT_MESSAGE =
  "La ubicación operativa de un producto cambió y el borrador tiene incidencias que impiden actualizarlo. Resuelve las incidencias antes de confirmar.";

/**
 * Indica si algun producto con cantidad recibida positiva conserva en el borrador guardado una
 * ubicacion distinta de la operativa actual (`staleSavedLocationId`) y esta ya puede persistirse.
 * Solo aplica con ubicaciones multiples activas y productos con control de inventario; sin
 * ubicacion operativa activa no hay nada valido que guardar (la validacion lo informa).
 * `detail.lines` es el estado canonico recien leido; `lines` las cantidades que se confirman.
 */
export function hasStaleLocationToPersist(
  detail: Pick<ReceivingDocumentDetail, "lines" | "capabilities">,
  lines: ReceivingDocumentLine[],
): boolean {
  if (!detail.capabilities.supportsMultipleLocations) return false;
  const requestedById = new Map(lines.map((line) => [line.id, line]));
  return detail.lines.some((canonical) => {
    if (!canonical.tracking.stock || !canonical.staleSavedLocationId || !canonical.locationId) {
      return false;
    }
    const requested = requestedById.get(canonical.id);
    return requested !== undefined && toFiniteNumber(requested.receivedNow) > 0;
  });
}

export function resolveReceivingLineLocation(input: {
  tenantId: string;
  branchId: string;
  savedLocationId?: string;
  defaultLocationId?: string | null;
  supportsMultipleLocations: boolean;
  locations: StorageLocation[];
}): string {
  if (!input.supportsMultipleLocations) return "";
  const validLocationIds = new Set(
    input.locations
      .filter(
        (location) =>
          location.tenantId === input.tenantId &&
          location.branchId === input.branchId &&
          location.status === LocationStatus.active,
      )
      .map((location) => location.id),
  );
  // La ubicacion guardada en un borrador NO se conserva: el backend solo recibe en la operativa
  // asignada del producto (GOODS_RECEIPT_LOCATION_INVALID). `savedLocationId` solo sirve para avisar.
  if (input.defaultLocationId && validLocationIds.has(input.defaultLocationId)) {
    return input.defaultLocationId;
  }
  return "";
}

function applyTransferReceptionPermissions(
  reception: TransferReceptionReadModel,
  hasPermission: boolean,
): TransferReceptionReadModel {
  if (hasPermission || !reception.canConfirmTransfer) return reception;
  return {
    ...reception,
    canConfirmTransfer: false,
    blockingReason: "No dispone de permisos para confirmar traslados.",
  };
}

export function buildApiTransferReception(input: {
  lines: ReceivingDocumentLine[];
  transferIsReceivable: boolean;
  activeLocationById: Map<string, StorageLocation>;
  productById: Map<string, Product>;
}): TransferReceptionReadModel {
  const pendingLines = input.lines.filter((line) => line.pendingQuantity > 0);
  const allLineIds = pendingLines.map((line) => line.id);
  if (!input.transferIsReceivable) {
    return blockedTransferReception(
      allLineIds,
      "El traslado debe estar en tránsito y tener cantidades despachadas pendientes para poder recibirse.",
    );
  }
  if (pendingLines.length === 0) {
    return blockedTransferReception([], "El traslado no tiene productos pendientes por recibir.");
  }

  const unavailableProductLineIds = pendingLines
    .filter((line) => !input.productById.has(line.productId))
    .map((line) => line.id);
  if (unavailableProductLineIds.length > 0) {
    return blockedTransferReception(
      unavailableProductLineIds,
      "No se pudo consultar la configuración de uno o más productos del traslado.",
    );
  }

  const traceabilityBlockedLineIds = pendingLines
    .filter((line) => line.tracking.lot || line.tracking.serial)
    .map((line) => line.id);
  if (traceabilityBlockedLineIds.length > 0) {
    return {
      ...blockedTransferReception(
        traceabilityBlockedLineIds,
        "La recepción de productos con lotes o series permanece bloqueada hasta que Backend exponga las selecciones físicas despachadas.",
      ),
      traceabilityBlockedLineIds,
    };
  }

  const missingLocationLineIds = pendingLines
    .filter((line) => !line.locationId || !input.activeLocationById.has(line.locationId))
    .map((line) => line.id);
  if (missingLocationLineIds.length > 0) {
    return blockedTransferReception(
      missingLocationLineIds,
      "Hay productos sin una ubicación operativa activa configurada en la sucursal destino.",
    );
  }

  const locationIds = [...new Set(pendingLines.map((line) => line.locationId))];
  if (locationIds.length !== 1) {
    return blockedTransferReception(
      allLineIds,
      "Los productos pendientes tienen ubicaciones operativas diferentes y el Backend solo admite una ubicación de destino por confirmación.",
    );
  }
  const destinationLocation = input.activeLocationById.get(locationIds[0]);
  if (!destinationLocation) {
    return blockedTransferReception(
      allLineIds,
      "La ubicación operativa configurada ya no está disponible en la sucursal destino.",
    );
  }
  return {
    requiresSingleDestinationLocation: true,
    canConfirmTransfer: true,
    destinationLocationId: destinationLocation.id,
    destinationLocationName: `${destinationLocation.code} · ${destinationLocation.name}`,
    blockedLineIds: [],
    traceabilityBlockedLineIds: [],
  };
}

function blockedTransferReception(
  blockedLineIds: string[],
  blockingReason: string,
): TransferReceptionReadModel {
  return {
    requiresSingleDestinationLocation: true,
    canConfirmTransfer: false,
    blockedLineIds,
    traceabilityBlockedLineIds: [],
    blockingReason,
  };
}

function toLocationOptions(
  locations: StorageLocation[],
  capabilities: BusinessCapabilitiesConfig,
  tenantId: string,
  branchId: string,
) {
  if (!capabilities.supportsMultipleLocations) return [];
  return locations
    .filter(
      (location) =>
        location.tenantId === tenantId &&
        location.branchId === branchId &&
        location.status === LocationStatus.active,
    )
    .map((location) => ({ id: location.id, name: location.name, code: location.code }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function toCapabilityFlags(
  capabilities: BusinessCapabilitiesConfig,
  entitlements: TenantEntitlementsDto,
): ReceivingCapabilityFlags {
  return {
    supportsInventory: capabilities.supportsInventory,
    supportsLots: isEffectiveBusinessCapabilityEnabled(entitlements, capabilities, "supportsLots"),
    supportsExpiration: isEffectiveBusinessCapabilityEnabled(
      entitlements,
      capabilities,
      "supportsExpiration",
    ),
    supportsSerials: isEffectiveBusinessCapabilityEnabled(
      entitlements,
      capabilities,
      "supportsSerials",
    ),
    supportsMultipleLocations: capabilities.supportsMultipleLocations,
    supportsUnitsAndPackaging: capabilities.supportsUnitsAndPackaging,
  };
}

function buildReceiptNotes(lines: Array<Pick<ReceiptLine, "rejectedQuantity">>) {
  const rejected = lines.reduce((sum, line) => sum + (line.rejectedQuantity ?? 0), 0);
  return rejected > 0 ? `Recepcion confirmada con ${rejected} unidades rechazadas.` : undefined;
}

function getPurchaseOrderStatusLabel(status: PurchaseOrderStatus) {
  const labels: Record<PurchaseOrderStatus, string> = {
    draft: "Borrador",
    pending_approval: "Pendiente de aprobacion",
    approved: "Aprobada",
    sent: "En proceso",
    partially_received: "Parcial",
    received: "Recibida",
    cancelled: "Cancelada",
  };
  return labels[status];
}

function isApiReceivablePurchaseOrder(status: PurchaseOrderStatus) {
  return (
    status === PurchaseOrderStatus.approved ||
    status === PurchaseOrderStatus.sent ||
    status === PurchaseOrderStatus.partially_received
  );
}
