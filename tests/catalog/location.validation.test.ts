import { describe, expect, it } from "vitest";
import { LocationStatus } from "@/core/enums";
import type { LocationListItem } from "@/modules/catalog/application/dto/LocationEditorDto";
import {
  locationToDto,
  validateLocationDto,
} from "@/modules/catalog/validation/location.validation";

const assignedLocation: LocationListItem = {
  id: "location-assigned",
  tenantId: "tenant-a",
  branchId: "branch-a",
  code: "BOD-1",
  name: "Bodega 1",
  type: "warehouse",
  depth: 0,
  status: LocationStatus.active,
  productCount: 2,
};

describe("location status validation", () => {
  it.each([LocationStatus.inactive, LocationStatus.archived])(
    "blocks known assigned locations from changing to %s",
    (status) => {
      const errors = validateLocationDto(
        { ...locationToDto(assignedLocation), status },
        [assignedLocation],
        assignedLocation.id,
      );

      expect(errors.status).toContain("Desasigna los productos");
    },
  );

  it("does not invent an assignment when the API count is unavailable", () => {
    const apiLocation = { ...assignedLocation, productCount: null };
    const errors = validateLocationDto(
      { ...locationToDto(apiLocation), status: LocationStatus.inactive },
      [apiLocation],
      apiLocation.id,
    );

    expect(errors.status).toBeUndefined();
  });
});
