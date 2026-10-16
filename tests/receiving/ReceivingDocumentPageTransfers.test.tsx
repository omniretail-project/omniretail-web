import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceivingDocumentDetail } from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import { ReceivingDocumentPage } from "@/modules/receiving/pages/ReceivingDocumentPage";
import { capabilityFlags, receivingLine } from "./receivingFixtures";

const state = vi.hoisted(() => ({ hook: {} as Record<string, unknown> }));

vi.mock("@/modules/receiving/hooks/useReceivingDocumentDetail", () => ({
  useReceivingDocumentDetail: () => state.hook,
}));

vi.mock("@/shared/hooks/useEntitlement", () => ({
  useEntitlement: () => ({ hasCapability: () => true }),
}));

vi.mock("@/shared/components/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("@/modules/receiving/hooks/useSerialPrecheck", () => ({
  findRepeatedSerials: () => [],
  useSerialPrecheck: () => ({ remoteDuplicates: [], unavailable: false }),
}));

function detail(traceable = false): ReceivingDocumentDetail {
  return {
    document: {
      id: "transfer-1",
      type: "transfer",
      number: "TR-001",
      typeLabel: "Traslado",
      originLabel: "Sucursal origen",
      originName: "Sucursal Central",
      branchId: "branch-1",
      branchName: "Sucursal Norte",
      tenantId: "tenant-1",
      statusLabel: "En tránsito",
    },
    lines: [receivingLine({
      id: "item-1",
      sourceLineId: "item-1",
      receivedNow: traceable ? 0 : 2,
      pendingQuantity: 5,
      orderedQuantity: 5,
      locationId: "location-1",
      tracking: {
        stock: true,
        lot: traceable,
        expiration: false,
        serial: false,
      },
    })],
    locations: [{ id: "location-1", code: "A-01", name: "Estante A" }],
    incidentTypes: [],
    incidents: [],
    previousReceipts: [],
    capabilities: capabilityFlags(),
    dataSource: "api",
    canConfirm: true,
    canManageIncidents: false,
    readOnly: false,
  };
}

function hookState(traceable = false) {
  const currentDetail = detail(traceable);
  const transferReception = traceable
    ? {
        requiresSingleDestinationLocation: true as const,
        canReceiveTransfer: true,
        canConfirmTransfer: false,
        blockedLineIds: [],
        traceabilityBlockedLineIds: ["item-1"],
        unavailableProductLineIds: [],
        blockingReason:
          "La recepción de productos con lotes permanece bloqueada hasta que Backend exponga las selecciones físicas despachadas.",
      }
    : {
        requiresSingleDestinationLocation: true as const,
        canReceiveTransfer: true,
        canConfirmTransfer: true,
        destinationLocationId: "location-1",
        destinationLocationName: "A-01 · Estante A",
        blockedLineIds: [],
        traceabilityBlockedLineIds: [],
        unavailableProductLineIds: [],
      };
  currentDetail.transferReception = transferReception;
  return {
    detail: currentDetail,
    lines: currentDetail.lines,
    incidents: [],
    loading: false,
    saving: false,
    incidentSaving: false,
    dirty: false,
    error: null,
    apiMode: true,
    transferReception,
    pendingTransferMessage: null,
    pendingTransferRetryReady: false,
    hasPendingTransferConfirmation: false,
    confirmAvailable: true,
    incidentsAvailable: false,
    updateLine: vi.fn(),
    updateLineQuantity: vi.fn(),
    saveProgress: vi.fn(),
    confirm: vi.fn(),
    saveIncident: vi.fn(),
    removeIncident: vi.fn(),
    createApiIncident: vi.fn(),
    resolveApiIncident: vi.fn(),
    downloadFinalReport: vi.fn(),
  };
}

describe("ReceivingDocumentPage transfer API", () => {
  beforeEach(() => { state.hook = hookState(); });

  it("shows the automatic destination location without a manual selector", () => {
    render(<ReceivingDocumentPage documentId="transfer-1" documentType="transfer" />);

    expect(screen.getByText("Ubicación automática: A-01 · Estante A")).toBeInTheDocument();
    expect(screen.getAllByText(/A-01 - Estante A/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox", { name: /ubicación/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirmar recepcion/i })).toBeEnabled();
  });

  it("shows the backend traceability limitation and disables confirmation", () => {
    state.hook = hookState(true);
    render(<ReceivingDocumentPage documentId="transfer-1" documentType="transfer" />);

    expect(screen.getAllByText(/selecciones físicas despachadas/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /confirmar recepcion/i })).toBeDisabled();
  });

  it("shows and enables only the exact pending retry even when the canonical detail is read-only", () => {
    state.hook = {
      ...hookState(),
      detail: { ...detail(), readOnly: true },
      pendingTransferMessage:
        "Existe una confirmación incierta. El reintento conservará exactamente el payload original.",
      pendingTransferRetryReady: true,
      hasPendingTransferConfirmation: true,
    };
    render(<ReceivingDocumentPage documentId="transfer-1" documentType="transfer" />);

    expect(screen.getByText(/existe una confirmación incierta/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirmar recepcion/i })).toBeEnabled();
    expect(
      screen.getAllByRole("textbox", { name: /cantidad/i })
        .every((input) => input.hasAttribute("disabled")),
    ).toBe(true);
  });
});
