import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportsDataDto } from "@/modules/administration/application/dto/ReportDto";

const state = vi.hoisted(() => ({
  data: null as unknown as ReportsDataDto,
  exportTenantId: "tenant-1",
  downloadCsv: vi.fn(),
  downloadXlsx: vi.fn(async () => undefined),
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = {};
  return { useRepositories: () => repositories };
});
vi.mock("@/shared/providers/EntitlementProvider", () => ({
  useEntitlementContext: () => ({ hasCapability: () => true }),
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({ hasPermission: () => true, loading: false }),
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));
vi.mock("@/modules/administration/application/services/GetReportsService", () => ({
  GetReportsService: class {
    execute() {
      return Promise.resolve(state.data);
    }
    authorizeExport() {
      return Promise.resolve(state.exportTenantId);
    }
  },
}));
vi.mock("@/modules/administration/application/reportCsv", () => ({ downloadReportCsv: state.downloadCsv }));
vi.mock("@/modules/administration/application/reportXlsx", () => ({
  downloadMultipleReportsXlsx: state.downloadXlsx,
}));

import { getLocalDateKey, useReports } from "@/modules/administration/hooks/useReports";

beforeEach(() => {
  state.exportTenantId = "tenant-1";
  state.downloadCsv.mockReset();
  state.downloadXlsx.mockClear();
  state.data = {
    tenantId: "tenant-1",
    sales: [],
    purchases: [],
    movements: [],
    payments: [
      {
        id: "pay-1",
        date: "2026-10-05T10:00:00",
        method: "card",
        status: "approved",
        amount: 150,
        reference: "=HYPERLINK(\"x\")",
        origin: "Ecommerce",
      },
    ],
  } as unknown as ReportsDataDto;
});

async function renderReports() {
  const hook = renderHook(() => useReports());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("useReports: exportacion CSV", () => {
  it("descarga un CSV por reporte con las columnas del reporte", async () => {
    const { result } = await renderReports();
    const dateKey = getLocalDateKey(new Date());

    await act(() =>
      result.current.exportConfigs(
        [
          { kind: "sales", filter: {} },
          { kind: "payments", filter: {} },
        ],
        "csv",
      ),
    );

    expect(state.downloadXlsx).not.toHaveBeenCalled();
    expect(state.downloadCsv).toHaveBeenCalledTimes(2);
    const [salesFile, salesData] = state.downloadCsv.mock.calls[0];
    const [paymentsFile, paymentsData] = state.downloadCsv.mock.calls[1];
    expect(salesFile).toBe(`Reporte_Ventas_${dateKey}.csv`);
    expect(salesData.rows).toEqual([]);
    expect(paymentsFile).toBe(`Reporte_Pagos_${dateKey}.csv`);
    expect(paymentsData.headers).toEqual(["Fecha", "Método", "Estado", "Monto", "Referencia", "Origen"]);
    expect(paymentsData.rows[0]).toEqual(expect.arrayContaining([150, "=HYPERLINK(\"x\")", "Ecommerce"]));
    expect(result.current.error).toBeNull();
  });

  it("sigue usando Excel cuando no se indica formato", async () => {
    const { result } = await renderReports();

    await act(() => result.current.exportConfigs([{ kind: "payments", filter: {} }]));

    expect(state.downloadCsv).not.toHaveBeenCalled();
    expect(state.downloadXlsx).toHaveBeenCalledTimes(1);
  });

  it("no descarga el CSV si la sesion ya pertenece a otra tienda", async () => {
    const { result } = await renderReports();
    state.exportTenantId = "otra-tienda";

    await act(() => result.current.exportConfigs([{ kind: "payments", filter: {} }], "csv"));

    expect(state.downloadCsv).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/ya no pertenecen a la sesión actual/);
  });
});
