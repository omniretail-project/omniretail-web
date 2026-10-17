import { describe, expect, it } from "vitest";
import {
  describeRegularizationBlocker,
  describeRegularizationFailure,
} from "@/modules/inventory/application/services/inventoryRegularizationMessages";

const P = "INVENTORY_REGULARIZATION_";

describe("describeRegularizationBlocker", () => {
  it.each([
    [
      `${P}STALE_SNAPSHOT`,
      "El inventario cambió desde la última consulta. Actualiza la información antes de continuar.",
    ],
    [
      `${P}RESERVATION_DRIFT`,
      "Las unidades reservadas no coinciden con el inventario registrado. No se realizó ningún cambio.",
    ],
    [
      `${P}PICKING_CONFLICT`,
      "Este producto tiene pedidos en preparación que impiden realizar la regularización.",
    ],
    [
      `${P}DESTINATION_NOT_ASSIGNED`,
      "Este producto todavía no tiene una ubicación de inventario asignada.",
    ],
    [`${P}NOT_REQUIRED`, "Este producto no tiene existencias pendientes de regularizar."],
  ])("translates %s and keeps the code only as a diagnostic", (code, title) => {
    const message = describeRegularizationBlocker({ code });

    expect(message.title).toBe(title);
    expect(message.diagnosticCode).toBe(code);
    expect(message.title).not.toContain(code);
  });

  it("covers every backend regularization code with a Spanish message", () => {
    const codes = [
      "LOCATIONS_DISABLED",
      "DESTINATION_NOT_ASSIGNED",
      "DESTINATION_INACTIVE",
      "NOT_REQUIRED",
      "THIRD_LOCATION_STOCK",
      "TRACEABILITY_INCONSISTENT",
      "TRACEABLE_RESERVATION",
      "RESERVATION_INVALID",
      "RESERVATION_OTHER_BALANCE",
      "RESERVATION_DRIFT",
      "PICKING_CONFLICT",
      "STALE_SNAPSHOT",
      "KEY_REUSED",
      "INCONSISTENT",
      "PRODUCT_NOT_ELIGIBLE",
    ];
    for (const code of codes) {
      const message = describeRegularizationBlocker({ code: `${P}${code}` });
      expect(message.title).not.toMatch(/INVENTORY_|_/);
      expect(message.title).not.toBe(
        "Hay una condición del inventario que impide realizar la regularización.",
      );
    }
  });

  it.each([
    [
      `${P}ASSIGNMENT_CONFLICT`,
      "Este producto ya tiene otra ubicación de inventario asignada. Actualiza la información antes de continuar.",
    ],
    [
      `${P}ASSIGNMENT_PERMISSION`,
      "Faltan permisos para asignar ubicaciones de inventario. Necesitas poder registrar ajustes y actualizar productos.",
    ],
    [
      `${P}BUSY`,
      "Otra operación está utilizando el inventario de este producto. No se realizó ningún cambio.",
    ],
    ["ACCESS_DENIED", "No tienes los permisos necesarios para asignar una ubicación inicial."],
  ])("translates the initial assignment code %s", (code, title) => {
    const message = describeRegularizationBlocker({ code });

    expect(message.title).toBe(title);
    expect(message.diagnosticCode).toBe(code);
    expect(message.title).not.toMatch(/INVENTORY_|ACCESS_DENIED|[0-9a-f]{8}-/);
  });

  it("presents a busy backend as safe to retry, even though the request is kept pending", () => {
    const message = describeRegularizationFailure(
      {
        kind: "uncertain",
        status: 409,
        code: `${P}BUSY`,
        message: "El producto está siendo modificado por otra operación.",
      },
      "execute",
    );

    expect(message.title).toMatch(/Otra operación está utilizando el inventario/);
    expect(message.hint).toMatch(/reintentar la misma solicitud de forma segura/);
    expect(message.title).not.toMatch(/No pudimos confirmar/);
    expect(message.diagnosticCode).toBe(`${P}BUSY`);
  });

  it("translates a denied assignment on execution", () => {
    const message = describeRegularizationFailure(
      { kind: "definitive", status: 403, code: "ACCESS_DENIED", message: "Asignar la ubicación..." },
      "execute",
    );

    expect(message.title).toBe(
      "No tienes los permisos necesarios para asignar una ubicación inicial.",
    );
  });

  it("uses a safe generic message for an unknown blocker code", () => {
    const message = describeRegularizationBlocker({ code: "SOMETHING_NEW" });

    expect(message.title).toBe(
      "Hay una condición del inventario que impide realizar la regularización.",
    );
    expect(message.diagnosticCode).toBe("SOMETHING_NEW");
  });
});

describe("describeRegularizationFailure", () => {
  it("never claims an uncertain result failed", () => {
    for (const failure of [
      { kind: "uncertain" as const, status: 503, code: "SERVICE_UNAVAILABLE", message: "x" },
      { kind: "uncertain" as const, status: 0, message: "No fue posible completar la solicitud." },
      { kind: "uncertain" as const, message: "Unexpected token < in JSON" },
      { kind: "uncertain" as const, status: 409, code: `${P}KEY_REUSED`, message: "clave" },
    ]) {
      const message = describeRegularizationFailure(failure, "execute");

      expect(message.title).toMatch(/No pudimos confirmar si la regularización se aplicó/);
      expect(message.title).not.toMatch(/falló|no se pudo completar|no se realizó/i);
      expect(message.title).not.toContain("Unexpected token");
    }
  });

  it("translates a definitive backend rejection by code and hides its raw message", () => {
    const message = describeRegularizationFailure(
      {
        kind: "definitive",
        status: 409,
        code: `${P}STALE_SNAPSHOT`,
        message: "El inventario cambió desde la vista previa. Vuelva a cargar la vista previa.",
      },
      "execute",
    );

    expect(message.title).toBe(
      "El inventario cambió desde la última consulta. Actualiza la información antes de continuar.",
    );
    expect(message.diagnosticCode).toBe(`${P}STALE_SNAPSHOT`);
  });

  it("keeps a local validation message written for the user", () => {
    expect(
      describeRegularizationFailure(
        {
          kind: "definitive",
          local: true,
          message: "No dispone de permisos para registrar ajustes de inventario.",
        },
        "execute",
      ).title,
    ).toBe("No dispone de permisos para registrar ajustes de inventario.");
  });

  it("replaces unknown or technical errors with a general safe message", () => {
    const technical = describeRegularizationFailure(
      {
        kind: "definitive",
        status: 400,
        code: "WEIRD",
        message: "java.lang.IllegalStateException at com.omniretail.backend.Service",
      },
      "execute",
    );
    expect(technical.title).toBe("Revisa los datos ingresados e inténtalo de nuevo.");
    expect(technical.title).not.toContain("java.lang");

    const unknownExecute = describeRegularizationFailure(
      { kind: "definitive", message: "TypeError: x is undefined" },
      "execute",
    );
    expect(unknownExecute.title).toBe(
      "No se pudo completar la regularización. No se realizó ningún cambio.",
    );

    const unknownLoad = describeRegularizationFailure(
      { status: 500, message: "NullPointerException" },
      "load",
    );
    expect(unknownLoad.title).toBe("No pudimos cargar la información en este momento.");
    expect(unknownLoad.title).not.toContain("NullPointer");
  });

  it("explains permission, missing data and generic conflicts", () => {
    expect(describeRegularizationFailure({ status: 403, message: "Forbidden" }, "load").title).toBe(
      "No tienes permiso para realizar esta operación.",
    );
    expect(describeRegularizationFailure({ status: 404, message: "Not found" }, "load").title).toBe(
      "No se encontró la información solicitada.",
    );
    expect(describeRegularizationFailure({ status: 409, message: "?" }, "execute").title).toMatch(
      /El inventario cambió/,
    );
  });
});
