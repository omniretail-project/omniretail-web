import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportsExportModal } from "@/modules/administration/components/ReportsExportModal";
import type { ReportsDataDto } from "@/modules/administration/application/dto/ReportDto";

const data: ReportsDataDto = { tenantId: "tenant-1", sales: [], purchases: [], movements: [], payments: [] };

function renderModal(onExport = vi.fn(async () => undefined), onClose = vi.fn()) {
  render(
    <ReportsExportModal
      data={data}
      initialFilter={{ from: "2026-10-01", to: "2026-10-31" }}
      initialKind="sales"
      onClose={onClose}
      onExport={onExport}
      open
    />,
  );
  return { onExport, onClose };
}

describe("ReportsExportModal: formato de exportacion", () => {
  it("usa Excel por defecto", async () => {
    const { onExport, onClose } = renderModal();

    expect(screen.getByLabelText(/Excel \(\.xlsx\)/)).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Generar Excel" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onExport).toHaveBeenCalledWith(
      [{ kind: "sales", filter: { from: "2026-10-01", to: "2026-10-31" } }],
      "xlsx",
    );
  });

  it("exporta en CSV los reportes seleccionados con sus filtros", async () => {
    const { onExport } = renderModal();

    fireEvent.click(screen.getByLabelText(/CSV \(\.csv\)/));
    fireEvent.click(screen.getByLabelText("Pagos"));
    fireEvent.click(screen.getByRole("button", { name: "Generar CSV" }));

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(onExport).toHaveBeenCalledWith(
      [
        { kind: "sales", filter: { from: "2026-10-01", to: "2026-10-31" } },
        { kind: "payments", filter: { from: "2026-10-01", to: "2026-10-31" } },
      ],
      "csv",
    );
  });

  it("vuelve a Excel si el usuario cambia de opinion", async () => {
    const { onExport } = renderModal();

    fireEvent.click(screen.getByLabelText(/CSV \(\.csv\)/));
    fireEvent.click(screen.getByLabelText(/Excel \(\.xlsx\)/));
    fireEvent.click(screen.getByRole("button", { name: "Generar Excel" }));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith(expect.any(Array), "xlsx"));
  });
});
