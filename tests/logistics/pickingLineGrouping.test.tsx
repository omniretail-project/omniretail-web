import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PickingDetailLineDto } from "@/modules/logistics/application/dto/PickingReadModelDto";
import { groupPickingLines, PickingLineList } from "@/modules/logistics/components/PickingLineList";
import { pickingIds, plainLine } from "./pickingFixtures";

vi.mock("@/modules/logistics/hooks/usePickingFefoPreview", () => ({
  usePickingFefoPreview: () => ({ status: "idle", data: null, error: null, canQuery: false, reload: vi.fn() }),
}));

function renderList(lines: PickingDetailLineDto[]) {
  const onUpdate = vi.fn(async () => true);
  const view = render(
    <PickingLineList
      autoFefoEnabled={false}
      disabled={false}
      editable
      incidents={[]}
      lines={lines}
      onUpdate={onUpdate}
      pickingOrderId={pickingIds.picking}
    />,
  );
  const rerenderWith = (next: PickingDetailLineDto[]) =>
    view.rerender(
      <PickingLineList
        autoFefoEnabled={false}
        disabled={false}
        editable
        incidents={[]}
        lines={next}
        onUpdate={onUpdate}
        pickingOrderId={pickingIds.picking}
      />,
    );
  return { rerenderWith };
}

/** Nombres de producto en el orden en que aparecen en pantalla. */
function visibleOrder() {
  return screen.getAllByRole("article").map((article) => article.querySelector("h4")?.textContent);
}

const pending = (key: string) => plainLine(key);
const partial = (key: string) => plainLine(key, { pickedQuantity: 4 });
const done = (key: string) => plainLine(key, { pickedQuantity: 10 });

describe("groupPickingLines", () => {
  it("separa pendientes (incluye parciales) de completados conservando el orden original", () => {
    const lines = [done("1"), pending("2"), partial("3"), done("4"), pending("5")];

    const { pending: open, completed } = groupPickingLines(lines);

    expect(open.map((line) => line.sku)).toEqual(["SKU-2", "SKU-3", "SKU-5"]);
    expect(completed.map((line) => line.sku)).toEqual(["SKU-1", "SKU-4"]);
  });

  it("considera completado solo cuando la cantidad restante es cero", () => {
    const { pending: open, completed } = groupPickingLines([plainLine("1", { pickedQuantity: 9.999 }), done("2")]);

    expect(open).toHaveLength(1);
    expect(completed).toHaveLength(1);
  });
});

describe("PickingLineList como cola de trabajo", () => {
  it("muestra primero «Pendientes de preparar» y debajo «Productos completados», ambos visibles", () => {
    renderList([done("1"), pending("2"), partial("3")]);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Productos por preparar",
      "Pendientes de preparar (2)",
      "Productos completados (1)",
    ]);
    expect(visibleOrder()).toEqual(["Producto 2", "Producto 3", "Producto 1"]);
  });

  it("no muestra un grupo vacio", () => {
    renderList([pending("1")]);

    expect(screen.getByText("Pendientes de preparar (1)")).toBeInTheDocument();
    expect(screen.queryByText(/Productos completados/)).not.toBeInTheDocument();
  });

  it("al completarse una linea pasa al final y el orden de las demas no cambia", () => {
    const { rerenderWith } = renderList([pending("1"), pending("2"), pending("3")]);

    rerenderWith([done("1"), pending("2"), pending("3")]);

    expect(visibleOrder()).toEqual(["Producto 2", "Producto 3", "Producto 1"]);
    expect(screen.getByText("Productos completados (1)")).toBeInTheDocument();
  });

  it("varias completadas conservan su orden original dentro del grupo", () => {
    const { rerenderWith } = renderList([pending("1"), pending("2"), pending("3")]);

    rerenderWith([pending("1"), done("2"), pending("3")]);
    rerenderWith([done("1"), done("2"), pending("3")]);

    expect(visibleOrder()).toEqual(["Producto 3", "Producto 1", "Producto 2"]);
  });

  it("una linea completada que queda pendiente otra vez regresa al primer grupo", () => {
    const { rerenderWith } = renderList([done("1"), pending("2")]);
    expect(visibleOrder()).toEqual(["Producto 2", "Producto 1"]);

    rerenderWith([partial("1"), pending("2")]);

    expect(visibleOrder()).toEqual(["Producto 1", "Producto 2"]);
    expect(screen.queryByText(/Productos completados/)).not.toBeInTheDocument();
  });

  it("recibir de nuevo la misma respuesta no reordena nada", () => {
    const lines = [done("1"), pending("2"), partial("3")];
    const { rerenderWith } = renderList(lines);
    const before = visibleOrder();

    rerenderWith([...lines]);
    rerenderWith(lines.map((line) => ({ ...line })));

    expect(visibleOrder()).toEqual(before);
  });

  it("conserva el estado de las demas tarjetas cuando una linea se completa y se mueve", () => {
    const { rerenderWith } = renderList([pending("1"), pending("2"), pending("3")]);
    const quantityOf = (name: string) =>
      screen.getAllByRole("spinbutton", { name: "Cantidad recogida hasta ahora" }).find(
        (input) => input.closest("article")?.querySelector("h4")?.textContent === name,
      ) as HTMLInputElement;
    fireEvent.change(quantityOf("Producto 3"), { target: { value: "7" } });
    const editing = quantityOf("Producto 3");

    rerenderWith([done("1"), pending("2"), pending("3")]);

    // Mismo nodo DOM (no se remonto) y el borrador sin enviar sigue ahi.
    expect(quantityOf("Producto 3")).toBe(editing);
    expect(quantityOf("Producto 3")).toHaveValue(7);
  });

  it("una tarjeta que cambia de grupo no se remonta (conserva su nodo)", () => {
    const { rerenderWith } = renderList([pending("1"), pending("2")]);
    const articleOf = (name: string) =>
      screen.getAllByRole("article").find((article) => article.querySelector("h4")?.textContent === name)!;
    const original = articleOf("Producto 1");

    rerenderWith([done("1"), pending("2")]);

    expect(articleOf("Producto 1")).toBe(original);
  });
});
