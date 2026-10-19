import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BusinessCapabilitiesConfig } from "@/core/entities";
import { BusinessPreset } from "@/core/enums";
import { businessDefaultsConfig } from "@/config/business-defaults";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { toBusinessConfigRequest } from "@/infrastructure/api/apiBusinessConfigMapper";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";
import { MemoryStorageAdapter } from "../inventory/mockInventoryFixtures";
import type { BusinessConfigDto } from "@/modules/administration/application/dto/BusinessConfigDto";
import { BusinessConfigForm } from "@/modules/administration/components/BusinessConfigForm";
import {
  enforceBusinessConfigCoherence,
  validateBusinessConfigDto,
} from "@/modules/administration/validation/businessConfig.validation";

const TENANT_ID = "tenant-demo";

function dto(overrides: Partial<BusinessConfigDto> = {}): BusinessConfigDto {
  return {
    ...businessDefaultsConfig[BusinessPreset.hardware_store],
    defaultProductTracking: { stock: true, lot: false, expiration: false, serial: false },
    ...overrides,
  };
}

function createRepository() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  return { store, repository: new MockBusinessConfigRepository(store, new DataEventBus()) };
}

describe("operational locations are derived from inventory control", () => {
  it("normalizes active inventory to active locations and inactive inventory to inactive locations", () => {
    expect(
      enforceBusinessConfigCoherence(dto({ supportsInventory: true, supportsMultipleLocations: false }))
        .supportsMultipleLocations,
    ).toBe(true);

    const withoutInventory = enforceBusinessConfigCoherence(
      dto({ supportsInventory: false, supportsMultipleLocations: true }),
    );
    expect(withoutInventory.supportsInventory).toBe(false);
    expect(withoutInventory.supportsMultipleLocations).toBe(false);
  });

  it("treats inactive inventory with active locations as invalid before normalizing", () => {
    expect(
      validateBusinessConfigDto(dto({ supportsInventory: false, supportsMultipleLocations: true }))
        .inventory,
    ).toBeTruthy();
    expect(validateBusinessConfigDto(dto())).toEqual({});
  });

  it("sends both fields to the backend with coherent values", () => {
    const config: BusinessCapabilitiesConfig = {
      ...dto({ supportsInventory: true, supportsMultipleLocations: false }),
      tenantId: TENANT_ID,
    };

    const request = toBusinessConfigRequest(config);

    expect(request.supportsInventory).toBe(true);
    expect(request.supportsMultipleLocations).toBe(true);
    expect(toBusinessConfigRequest({ ...config, supportsInventory: false, supportsMultipleLocations: false }))
      .toMatchObject({ supportsInventory: false, supportsMultipleLocations: false });
  });
});

describe("MockBusinessConfigRepository", () => {
  it("stores true/false as true/true", async () => {
    const { repository } = createRepository();

    const updated = await repository.updateCapabilities(TENANT_ID, {
      supportsInventory: true,
      supportsMultipleLocations: false,
    });

    expect(updated).toMatchObject({ supportsInventory: true, supportsMultipleLocations: true });
  });

  it("rejects false/true and leaves the stored configuration untouched", async () => {
    const { repository } = createRepository();
    const before = await repository.getCapabilities(TENANT_ID);

    await expect(
      repository.updateCapabilities(TENANT_ID, {
        supportsInventory: false,
        supportsMultipleLocations: true,
      }),
    ).rejects.toThrow("ubicaciones operativas");

    expect(await repository.getCapabilities(TENANT_ID)).toEqual(before);
  });

  it("normalizes persisted configurations when the store is hydrated", () => {
    const storage = new MemoryStorageAdapter();
    const first = new MockDatabaseStore(storage);
    first.mutate((database) => {
      const config = database.businessCapabilities.find((item) => item.tenantId === TENANT_ID);
      if (config) {
        config.supportsInventory = true;
        config.supportsMultipleLocations = false;
      }
    });

    const hydrated = new MockDatabaseStore(storage).getSnapshot();

    expect(
      hydrated.businessCapabilities.find((item) => item.tenantId === TENANT_ID),
    ).toMatchObject({ supportsInventory: true, supportsMultipleLocations: true });
  });
});

describe("BusinessConfigForm", () => {
  function renderForm(value: BusinessConfigDto) {
    const onCapabilityChange = vi.fn();
    render(
      <BusinessConfigForm
        busy={false}
        onCapabilityChange={onCapabilityChange}
        onPosPaymentChange={vi.fn()}
        onPresetChange={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
        onTrackingChange={vi.fn()}
        value={value}
      />,
    );
    return { onCapabilityChange };
  }

  it("does not render a redundant locations card, with inventory on or off", () => {
    const { onCapabilityChange } = renderForm(dto());

    expect(screen.queryByLabelText(/Ubicaciones operativas/)).toBeNull();
    expect(screen.queryByLabelText(/Múltiples ubicaciones/)).toBeNull();
    expect(screen.getByLabelText(/Control de inventario/)).toBeChecked();
    expect(onCapabilityChange).not.toHaveBeenCalled();
  });

  it("keeps the inventory switch and the contract coherence without the card", () => {
    renderForm(dto({ supportsInventory: false, supportsMultipleLocations: false }));

    expect(screen.queryByLabelText(/Ubicaciones operativas/)).toBeNull();
    expect(screen.getByLabelText(/Control de inventario/)).not.toBeChecked();
  });
});
