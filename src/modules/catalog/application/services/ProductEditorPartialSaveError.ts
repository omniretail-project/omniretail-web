export type ProductEditorFailedSection =
  | "price"
  | "conversions"
  | "attributes"
  | "priceTiers"
  | "suppliers"
  | "inventorySettings"
  | "kitComponents"
  | "media"
  | "restore"
  | "canonicalReload";

const SECTION_LABELS: Record<ProductEditorFailedSection, string> = {
  price: "precio",
  conversions: "conversiones",
  attributes: "atributos",
  priceTiers: "precios por cantidad",
  suppliers: "proveedores y costos",
  inventorySettings: "configuracion de inventario",
  kitComponents: "componentes del kit",
  media: "multimedia",
  restore: "restauracion del kit",
  canonicalReload: "recarga canonica",
};

export class ProductEditorPartialSaveError extends Error {
  constructor(
    readonly productId: string,
    readonly coreSaved: boolean,
    readonly failedSections: ProductEditorFailedSection[],
    readonly failureMessages: string[] = [],
  ) {
    const sections = failedSections.map((section) => SECTION_LABELS[section]).join(", ");
    const details = [...new Set(failureMessages.filter(Boolean))].join(" ");
    super(
      `${coreSaved ? "El producto fue guardado" : "El producto ya existe"}, pero quedaron secciones pendientes: ${sections}. ` +
        `${details ? `${details} ` : ""}` +
        "Revise los datos recargados e intente guardar nuevamente.",
    );
    this.name = "ProductEditorPartialSaveError";
  }
}
