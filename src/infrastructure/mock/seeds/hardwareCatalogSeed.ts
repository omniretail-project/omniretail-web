import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import {
  CategoryStatus,
  ProductStatus,
  ProductType,
  SerialStatus,
  SupplierStatus,
} from "@/core/enums";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const now = "2026-01-01T12:00:00.000Z";

interface HardwareProductSpec {
  id: string;
  sku: string;
  name: string;
  brand: string;
  categoryId: string;
  description: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  attributes: Record<string, string>;
  supplierId: string;
  image: string;
  tiers?: Array<[minimum: number, price: number]>;
  minimumOrder?: number;
  leadTimeDays?: number;
  unitId?: string;
  locationId?: string;
  mobileApp?: boolean;
  serialTracking?: boolean;
}

const categorySpecs = [
  ["cat-hand-tools", "Herramientas manuales", "herramientas-manuales"],
  ["cat-power-tools", "Herramientas eléctricas", "herramientas-electricas"],
  ["cat-fasteners", "Tornillería y fijaciones", "tornilleria-fijaciones"],
  ["cat-electricity", "Electricidad", "electricidad"],
  ["cat-plumbing", "Plomería", "plomeria"],
  ["cat-paint", "Pintura y accesorios", "pintura-accesorios"],
  ["cat-construction", "Construcción y albañilería", "construccion-albanileria"],
  ["cat-locksmith", "Cerrajería y seguridad", "cerrajeria-seguridad"],
  ["cat-adhesives", "Adhesivos y selladores", "adhesivos-selladores"],
  ["cat-garden", "Jardinería", "jardineria"],
] as const;

const productSpecs: HardwareProductSpec[] = [
  {
    id: "prod-hammer",
    sku: "HER-MAN-001",
    name: "Martillo de uña 16 oz",
    brand: "Truper",
    categoryId: "cat-hand-tools",
    description:
      "Martillo de acero con mango ergonómico para trabajos generales de carpintería, reparación y construcción.",
    price: 75,
    cost: 48,
    stock: 24,
    minStock: 6,
    attributes: { Peso: "16 oz", "Material cabeza": "Acero", Mango: "Fibra" },
    supplierId: "supplier-tools",
    minimumOrder: 6,
    leadTimeDays: 3,
    image: "/images/products/martillo-una-16oz.webp",
  },
  {
    id: "prod-screwdriver-set",
    sku: "HER-MAN-002",
    name: "Juego de destornilladores 6 piezas",
    brand: "Truper",
    categoryId: "cat-hand-tools",
    description:
      "Juego de destornilladores planos y Phillips para mantenimiento y reparaciones domésticas o profesionales.",
    price: 65,
    cost: 42,
    stock: 8,
    minStock: 5,
    attributes: { Piezas: "6", Punta: "Plana / Phillips", Material: "Acero Cr-V" },
    supplierId: "supplier-tools",
    minimumOrder: 4,
    leadTimeDays: 3,
    image: "/images/products/juego-destornilladores-6p.webp",
  },
  {
    id: "prod-handsaw",
    sku: "HER-MAN-003",
    name: 'Serrucho profesional 20"',
    brand: "Truper",
    categoryId: "cat-hand-tools",
    description:
      "Serrucho de uso general para cortes manuales en madera, ideal para carpintería, construcción y reparaciones.",
    price: 89,
    cost: 56,
    stock: 14,
    minStock: 4,
    attributes: {
      Longitud: '20"',
      "Material de hoja": "Acero",
      "Tipo de corte": "Universal",
      Mango: "Ergonómico",
    },
    tiers: [[5, 84]],
    supplierId: "supplier-tools",
    minimumOrder: 4,
    leadTimeDays: 3,
    image: "/images/products/serrucho-profesional-20.webp",
  },
  {
    id: "prod-drill",
    sku: "HER-ELE-001",
    name: "Taladro percutor 750 W",
    brand: "Bosch",
    categoryId: "cat-power-tools",
    description:
      "Taladro percutor de 750 W con mandril de 13 mm para perforación en madera, metal y mampostería.",
    price: 599,
    cost: 430,
    stock: 6,
    minStock: 3,
    attributes: { Potencia: "750 W", Mandril: "13 mm", Voltaje: "120 V", Percusión: "Sí" },
    supplierId: "supplier-tools",
    minimumOrder: 2,
    leadTimeDays: 5,
    serialTracking: true,
    locationId: "loc-centro-b",
    image: "/images/products/taladro-percutor-750w.webp",
  },
  {
    id: "prod-angle-grinder",
    sku: "HER-ELE-002",
    name: 'Esmeril angular 4½" 850 W',
    brand: "Truper",
    categoryId: "cat-power-tools",
    description:
      "Esmeril angular compacto para corte y desbaste de metal, con potencia de 850 W y alta velocidad.",
    price: 489,
    cost: 350,
    stock: 0,
    minStock: 2,
    attributes: { Disco: '4½"', Potencia: "850 W", RPM: "11000" },
    supplierId: "supplier-tools",
    minimumOrder: 2,
    leadTimeDays: 5,
    locationId: "loc-centro-b",
    image: "/images/products/esmeril-angular-4-5.webp",
  },
  {
    id: "prod-multimeter",
    sku: "HER-ELE-003",
    name: "Multímetro digital profesional",
    brand: "Ingco",
    categoryId: "cat-power-tools",
    description:
      "Multímetro digital con pantalla LCD para medición de voltaje, resistencia y pruebas de continuidad.",
    price: 185,
    cost: 120,
    stock: 12,
    minStock: 4,
    attributes: {
      Pantalla: "LCD",
      "Voltaje AC": "600 V",
      "Voltaje DC": "600 V",
      Continuidad: "Sí",
    },
    supplierId: "supplier-electric",
    image: "/images/products/multimetro-digital.webp",
  },
  {
    id: "prod-screws",
    sku: "FIJ-TOR-001",
    name: 'Tornillo para madera 2" caja 100',
    brand: "Fiero",
    categoryId: "cat-fasteners",
    description:
      "Caja de tornillos galvanizados para madera, indicada para carpintería, montaje y reparaciones.",
    price: 45,
    cost: 28,
    stock: 80,
    minStock: 20,
    attributes: { Longitud: '2"', Acabado: "Galvanizado", Cantidad: "100" },
    tiers: [
      [5, 42],
      [10, 39],
    ],
    supplierId: "supplier-construction",
    unitId: "unit-box",
    image: "/images/products/tornillo-madera-2in-caja100.webp",
  },
  {
    id: "prod-self-tapping-screws",
    sku: "FIJ-TOR-002",
    name: 'Tornillo autorroscante 1" caja 100',
    brand: "Fiero",
    categoryId: "cat-fasteners",
    description:
      "Caja de tornillos autorroscantes con cabeza Phillips para lámina y perfiles metálicos livianos.",
    price: 52,
    cost: 31,
    stock: 45,
    minStock: 20,
    attributes: { Longitud: '1"', Cabeza: "Phillips", Cantidad: "100" },
    tiers: [[5, 48]],
    supplierId: "supplier-construction",
    unitId: "unit-box",
    image: "/images/products/tornillo-autorroscante-1in-caja100.webp",
  },
  {
    id: "prod-wall-plugs",
    sku: "FIJ-TAR-001",
    name: "Tarugo plástico 8 mm paquete 50",
    brand: "Fiero",
    categoryId: "cat-fasteners",
    description:
      "Paquete de tarugos de nylon para fijaciones confiables en concreto, ladrillo y mampostería.",
    price: 30,
    cost: 18,
    stock: 12,
    minStock: 10,
    attributes: { Diámetro: "8 mm", Material: "Nylon", Cantidad: "50" },
    tiers: [[10, 27]],
    supplierId: "supplier-construction",
    unitId: "unit-pack",
    image: "/images/products/tarugo-plastico-8mm-pack50.webp",
  },
  {
    id: "prod-thhn-wire",
    sku: "ELE-CAB-001",
    name: "Cable THHN calibre 12",
    brand: "Condumex",
    categoryId: "cat-electricity",
    description:
      "Cable eléctrico THHN de cobre calibre 12 para instalaciones residenciales y comerciales.",
    price: 6.5,
    cost: 4.1,
    stock: 250,
    minStock: 50,
    attributes: { Calibre: "12 AWG", Conductor: "Cobre", Aislamiento: "THHN" },
    tiers: [
      [50, 5.9],
      [100, 5.5],
    ],
    supplierId: "supplier-electric",
    unitId: "unit-meter",
    image: "/images/products/cable-thhn-cal12.webp",
  },
  {
    id: "prod-duplex-outlet",
    sku: "ELE-TOM-001",
    name: "Tomacorriente doble polarizado",
    brand: "Volteck",
    categoryId: "cat-electricity",
    description: "Tomacorriente doble polarizado para instalaciones residenciales de 125 V y 15 A.",
    price: 28,
    cost: 16,
    stock: 30,
    minStock: 10,
    attributes: { Voltaje: "125 V", Corriente: "15 A", Tipo: "Doble" },
    tiers: [[10, 25]],
    supplierId: "supplier-electric",
    image: "/images/products/tomacorriente-doble.webp",
  },
  {
    id: "prod-light-switch",
    sku: "ELE-INT-001",
    name: "Interruptor sencillo",
    brand: "Volteck",
    categoryId: "cat-electricity",
    description: "Interruptor sencillo de una vía para circuitos residenciales de 125 V y 15 A.",
    price: 18,
    cost: 10,
    stock: 4,
    minStock: 8,
    attributes: { Voltaje: "125 V", Corriente: "15 A", Tipo: "1 vía" },
    tiers: [[10, 16]],
    supplierId: "supplier-electric",
    image: "/images/products/interruptor-sencillo.webp",
  },
  {
    id: "prod-pvc-pipe",
    sku: "PLO-PVC-001",
    name: 'Tubo PVC ½" x 3 m',
    brand: "Amanco",
    categoryId: "cat-plumbing",
    description:
      "Tubo PVC de media pulgada y tres metros para conducción de agua en instalaciones.",
    price: 32,
    cost: 20,
    stock: 40,
    minStock: 10,
    attributes: { Diámetro: '½"', Longitud: "3 m", Material: "PVC" },
    supplierId: "supplier-plumbing",
    mobileApp: false,
    image: "/images/products/tubo-pvc-media-3m.webp",
  },
  {
    id: "prod-pvc-elbow",
    sku: "PLO-PVC-002",
    name: 'Codo PVC ½" 90°',
    brand: "Amanco",
    categoryId: "cat-plumbing",
    description: "Codo PVC de 90 grados para cambios de dirección en tubería de media pulgada.",
    price: 3.5,
    cost: 1.7,
    stock: 100,
    minStock: 25,
    attributes: { Diámetro: '½"', Ángulo: "90°", Material: "PVC" },
    tiers: [[20, 3]],
    supplierId: "supplier-plumbing",
    image: "/images/products/codo-pvc-media.webp",
  },
  {
    id: "prod-shutoff-valve",
    sku: "PLO-VAL-001",
    name: 'Llave de paso ½"',
    brand: "Foset",
    categoryId: "cat-plumbing",
    description: "Llave de paso tipo esfera fabricada en latón para tubería de media pulgada.",
    price: 48,
    cost: 29,
    stock: 20,
    minStock: 5,
    attributes: { Diámetro: '½"', Material: "Latón", Tipo: "Esfera" },
    supplierId: "supplier-plumbing",
    image: "/images/products/llave-paso-media.webp",
  },
  {
    id: "prod-pvc-cement",
    sku: "PLO-PEG-001",
    name: "Pegamento para PVC ¼ galón",
    brand: "Oatey",
    categoryId: "cat-plumbing",
    description: "Cemento solvente para unir tubería y accesorios de PVC en trabajos de plomería.",
    price: 92,
    cost: 61,
    stock: 19,
    minStock: 5,
    attributes: {
      Presentación: "¼ galón",
      Aplicación: "PVC",
      Tipo: "Cemento solvente",
      Uso: "Plomería",
    },
    tiers: [
      [6, 87],
      [12, 82],
    ],
    supplierId: "supplier-plumbing",
    minimumOrder: 6,
    leadTimeDays: 4,
    image: "/images/products/pegamento-pvc-cuarto-galon.webp",
  },
  {
    id: "prod-latex-paint",
    sku: "PIN-LAT-001",
    name: "Pintura látex blanca 1 galón",
    brand: "Lanco",
    categoryId: "cat-paint",
    description: "Pintura látex blanca de acabado mate para interiores y exteriores protegidos.",
    price: 185,
    cost: 125,
    stock: 18,
    minStock: 5,
    attributes: { Color: "Blanco", Acabado: "Mate", Contenido: "1 galón" },
    supplierId: "supplier-paint",
    image: "/images/products/pintura-latex-blanca-galon.webp",
  },
  {
    id: "prod-paint-roller",
    sku: "PIN-ROD-001",
    name: 'Rodillo para pintura 9"',
    brand: "Truper",
    categoryId: "cat-paint",
    description:
      "Rodillo de felpa de nueve pulgadas para aplicación uniforme de pintura en paredes.",
    price: 45,
    cost: 28,
    stock: 22,
    minStock: 6,
    attributes: { Ancho: '9"', Material: "Felpa", Uso: "Paredes" },
    supplierId: "supplier-paint",
    image: "/images/products/rodillo-pintura-9.webp",
  },
  {
    id: "prod-paint-brush",
    sku: "PIN-BRO-001",
    name: 'Brocha profesional 2"',
    brand: "Truper",
    categoryId: "cat-paint",
    description: "Brocha profesional de dos pulgadas con cerda mixta y mango de madera.",
    price: 28,
    cost: 16,
    stock: 35,
    minStock: 10,
    attributes: { Ancho: '2"', Cerda: "Mixta", Mango: "Madera" },
    supplierId: "supplier-paint",
    image: "/images/products/brocha-2in.webp",
  },
  {
    id: "prod-cement",
    sku: "CON-CEM-001",
    name: "Cemento gris 42.5 kg",
    brand: "Cementos Progreso",
    categoryId: "cat-construction",
    description:
      "Saco de cemento gris de uso general para concreto, mortero y trabajos de albañilería.",
    price: 82,
    cost: 68,
    stock: 60,
    minStock: 20,
    attributes: { Peso: "42.5 kg", Tipo: "Uso general" },
    tiers: [
      [10, 79],
      [20, 76],
    ],
    supplierId: "supplier-construction",
    mobileApp: false,
    locationId: "loc-centro-b",
    image: "/images/products/cemento-gris-42-5kg.webp",
  },
  {
    id: "prod-tape-measure",
    sku: "CON-MED-001",
    name: "Cinta métrica 5 m",
    brand: "Pretul",
    categoryId: "cat-construction",
    description:
      "Cinta métrica retráctil de cinco metros con seguro para mediciones de obra y taller.",
    price: 55,
    cost: 33,
    stock: 25,
    minStock: 8,
    attributes: { Longitud: "5 m", "Ancho cinta": "19 mm", Seguro: "Sí" },
    supplierId: "supplier-tools",
    image: "/images/products/cinta-metrica-5m.webp",
  },
  {
    id: "prod-level",
    sku: "CON-NIV-001",
    name: 'Nivel de aluminio 24"',
    brand: "Truper",
    categoryId: "cat-construction",
    description:
      "Nivel de aluminio con tres burbujas para alineación horizontal, vertical y angular.",
    price: 110,
    cost: 72,
    stock: 9,
    minStock: 3,
    attributes: { Longitud: '24"', Material: "Aluminio", Burbujas: "3" },
    supplierId: "supplier-tools",
    image: "/images/products/nivel-aluminio-24.webp",
  },
  {
    id: "prod-padlock",
    sku: "CER-CAN-001",
    name: "Candado laminado 50 mm",
    brand: "Yale",
    categoryId: "cat-locksmith",
    description:
      "Candado laminado de acero de 50 mm para protección de portones, bodegas y gabinetes.",
    price: 85,
    cost: 55,
    stock: 16,
    minStock: 5,
    attributes: { Ancho: "50 mm", Llaves: "2", Material: "Acero" },
    supplierId: "supplier-security",
    image: "/images/products/candado-laminado-50mm.webp",
  },
  {
    id: "prod-bedroom-lock",
    sku: "CER-CER-001",
    name: "Cerradura de pomo para dormitorio",
    brand: "Yale",
    categoryId: "cat-locksmith",
    description: "Cerradura de pomo con acabado níquel para puertas interiores de dormitorio.",
    price: 145,
    cost: 95,
    stock: 10,
    minStock: 4,
    attributes: { Tipo: "Pomo", Uso: "Interior", Acabado: "Níquel" },
    supplierId: "supplier-security",
    image: "/images/products/cerradura-pomo-dormitorio.webp",
  },
  {
    id: "prod-deadbolt",
    sku: "CER-CER-002",
    name: "Cerrojo de seguridad para puerta",
    brand: "Yale",
    categoryId: "cat-locksmith",
    description:
      "Cerrojo residencial reforzado de acero con acabado níquel y tres llaves incluidas.",
    price: 175,
    cost: 118,
    stock: 13,
    minStock: 4,
    attributes: {
      Tipo: "Cerrojo",
      Material: "Acero",
      "Llaves incluidas": "3",
      Uso: "Residencial",
      Acabado: "Níquel",
    },
    tiers: [[5, 165]],
    supplierId: "supplier-security",
    minimumOrder: 3,
    leadTimeDays: 5,
    image: "/images/products/cerrojo-seguridad-puerta.webp",
  },
  {
    id: "prod-silicone",
    sku: "ADH-SIL-001",
    name: "Silicón transparente 280 ml",
    brand: "Sista",
    categoryId: "cat-adhesives",
    description:
      "Sellador de silicón transparente para juntas, vidrio, aluminio y aplicaciones domésticas.",
    price: 38,
    cost: 22,
    stock: 28,
    minStock: 8,
    attributes: { Contenido: "280 ml", Color: "Transparente", Tipo: "Sellador" },
    tiers: [[12, 34]],
    supplierId: "supplier-paint",
    image: "/images/products/silicon-transparente-280ml.webp",
  },
  {
    id: "prod-ptfe-tape",
    sku: "ADH-TEF-001",
    name: 'Cinta teflón ½" x 12 m',
    brand: "Foset",
    categoryId: "cat-adhesives",
    description: "Cinta de PTFE para sellar uniones roscadas en instalaciones hidráulicas.",
    price: 8,
    cost: 3.5,
    stock: 70,
    minStock: 20,
    attributes: { Ancho: '½"', Longitud: "12 m", Material: "PTFE" },
    tiers: [[12, 6.5]],
    supplierId: "supplier-plumbing",
    image: "/images/products/cinta-teflon-media-12m.webp",
  },
  {
    id: "prod-hose",
    sku: "JAR-MAN-001",
    name: "Manguera reforzada 15 m",
    brand: "Truper",
    categoryId: "cat-garden",
    description:
      "Manguera reforzada de tres capas para riego doméstico y tareas generales de jardín.",
    price: 165,
    cost: 110,
    stock: 14,
    minStock: 4,
    attributes: { Longitud: "15 m", Diámetro: '½"', Capas: "3" },
    supplierId: "supplier-garden",
    image: "/images/products/manguera-reforzada-15m.webp",
  },
  {
    id: "prod-shovel",
    sku: "JAR-PAL-001",
    name: "Pala jardinera cuadrada",
    brand: "Truper",
    categoryId: "cat-garden",
    description: "Pala cuadrada de acero con mango de madera para jardinería, carga y nivelación.",
    price: 95,
    cost: 61,
    stock: 11,
    minStock: 4,
    attributes: { Material: "Acero", Mango: "Madera", Tipo: "Cuadrada" },
    supplierId: "supplier-garden",
    image: "/images/products/pala-jardinera-cuadrada.webp",
  },
  {
    id: "prod-pruning-shears",
    sku: "JAR-TIJ-001",
    name: 'Tijera de podar 8"',
    brand: "Truper",
    categoryId: "cat-garden",
    description: "Tijera compacta de podar con hoja de acero y mango antideslizante para jardín.",
    price: 85,
    cost: 52,
    stock: 17,
    minStock: 5,
    attributes: { Longitud: '8"', Hoja: "Acero", Mango: "Antideslizante" },
    supplierId: "supplier-garden",
    image: "/images/products/tijera-podar-8.webp",
  },
];

const supplierSpecs = [
  ["supplier-tools", "Atlas Herramientas", "ventas@atlas.demo", 3],
  ["supplier-electric", "ElectroSuministros GT", "ventas@electrosuministros.demo", 4],
  ["supplier-construction", "Materiales El Constructor", "ventas@elconstructor.demo", 4],
  ["supplier-plumbing", "Plomería Maya", "ventas@plomeriamaya.demo", 4],
  ["supplier-paint", "Pinturas Chapinas", "ventas@pinturaschapinas.demo", 4],
  ["supplier-security", "Seguridad Ferretera GT", "ventas@seguridadferretera.demo", 5],
  ["supplier-garden", "Jardín y Hogar GT", "ventas@jardinyhogar.demo", 4],
] as const;

const attributeNames = [
  ...new Set(productSpecs.flatMap((product) => Object.keys(product.attributes))),
];
const attributeId = (name: string) => `attr-hardware-${slug(name)}`;

export const hardwareCatalogSeed: Pick<
  MockDatabase,
  | "categories"
  | "products"
  | "productKitComponents"
  | "productPriceHistory"
  | "productMedia"
  | "unitConversions"
  | "attributeDefinitions"
  | "productAttributeValues"
  | "productSalesPriceTiers"
  | "productInventorySettings"
  | "inventoryBalances"
  | "stockLots"
  | "serialNumbers"
  | "suppliers"
  | "supplierProducts"
  | "supplierCostTiers"
> = {
  categories: categorySpecs.map(([id, name, slugValue]) => ({
    id,
    tenantId,
    name,
    slug: slugValue,
    image: { kind: "url", src: `/images/categories/${slugValue}.png` },
    status: CategoryStatus.active,
    createdAt: now,
    updatedAt: now,
  })),
  products: productSpecs.map((spec, index) => ({
    id: spec.id,
    tenantId,
    sku: spec.sku,
    barcode: ean13(index + 1),
    name: spec.name,
    description: spec.description,
    brand: spec.brand,
    productType: ProductType.physical,
    categoryId: spec.categoryId,
    baseUnitId: spec.unitId ?? "unit-unit",
    saleUnitId: spec.unitId ?? "unit-unit",
    salePrice: spec.price,
    status: ProductStatus.published,
    tracking: {
      stock: true,
      lot: false,
      expiration: false,
      serial: spec.serialTracking ?? false,
    },
    channels: { ecommerce: true, pos: true, mobileApp: spec.mobileApp ?? true },
    createdAt: now,
    updatedAt: now,
  })),
  productKitComponents: [],
  productPriceHistory: [],
  productMedia: productSpecs.map((spec) => ({
    id: `media-${spec.id}`,
    tenantId,
    productId: spec.id,
    type: "image",
    url: spec.image,
    source: { kind: "url", src: spec.image },
    alt: spec.name,
    isPrimary: true,
    sortOrder: 0,
    createdAt: now,
  })),
  unitConversions: [],
  attributeDefinitions: attributeNames.map((name) => ({
    id: attributeId(name),
    tenantId,
    name,
    code: slug(name),
    dataType: "text",
    required: false,
    active: true,
    createdAt: now,
    updatedAt: now,
  })),
  productAttributeValues: productSpecs.flatMap((spec) =>
    Object.entries(spec.attributes).map(([name, value]) => ({
      id: `attribute-value-${spec.id}-${slug(name)}`,
      productId: spec.id,
      attributeDefinitionId: attributeId(name),
      value,
    })),
  ),
  productSalesPriceTiers: productSpecs.flatMap((spec) =>
    (spec.tiers ?? []).map(([minQuantity, unitPrice]) => ({
      id: `sales-tier-${spec.id}-${minQuantity}`,
      tenantId,
      productId: spec.id,
      minQuantity,
      unitPrice,
      active: true,
      createdAt: now,
      updatedAt: now,
    })),
  ),
  productInventorySettings: productSpecs.map((spec) => ({
    id: `product-inventory-settings-${spec.id}-${branchId}`,
    tenantId,
    productId: spec.id,
    branchId,
    minStock: spec.minStock,
    reorderPoint: spec.minStock + Math.max(1, Math.ceil(spec.minStock / 2)),
    defaultLocationId: spec.locationId ?? locationForCategory(spec.categoryId),
    createdAt: now,
    updatedAt: now,
  })),
  inventoryBalances: productSpecs.map((spec) => ({
    id:
      spec.id === "prod-drill"
        ? "bal-drill"
        : spec.id === "prod-screws"
          ? "bal-screws"
          : `balance-${spec.id}`,
    tenantId,
    branchId,
    productId: spec.id,
    locationId: spec.locationId ?? locationForCategory(spec.categoryId),
    quantity: spec.stock,
    reservedQuantity: spec.id === "prod-drill" ? 1 : spec.id === "prod-screws" ? 2 : 0,
    minStock: spec.minStock,
    reorderPoint: spec.minStock + Math.max(1, Math.ceil(spec.minStock / 2)),
    updatedAt: now,
  })),
  stockLots: [],
  serialNumbers: ["001", "002", "003", "004", "005", "006"].map((suffix) => ({
    id: `serial-drill-${suffix}`,
    tenantId,
    branchId,
    productId: "prod-drill",
    locationId: "loc-centro-b",
    serialNumber: `DRILL-SN-${suffix}`,
    status: SerialStatus.available,
    createdAt: now,
    updatedAt: now,
  })),
  suppliers: supplierSpecs.map(([id, name, email, leadTimeDays]) => ({
    id,
    tenantId,
    name,
    email,
    leadTimeDays,
    status: SupplierStatus.active,
    createdAt: now,
    updatedAt: now,
  })),
  supplierProducts: productSpecs.map((spec) => {
    const defaultLead = supplierSpecs.find(([id]) => id === spec.supplierId)?.[3] ?? 4;
    return {
      id: `supplier-product-${spec.id}`,
      tenantId,
      supplierId: spec.supplierId,
      productId: spec.id,
      supplierSku: `${spec.supplierId.replace("supplier-", "").toUpperCase()}-${spec.sku}`,
      purchaseUnitId: spec.unitId ?? "unit-unit",
      purchaseToBaseFactor: 1,
      lastCost: spec.cost,
      leadTimeDays: spec.leadTimeDays ?? defaultLead,
      minimumOrderQuantity: spec.minimumOrder ?? 1,
      preferred: true,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
  }),
  supplierCostTiers: productSpecs.map((spec) => ({
    id: `supplier-cost-${spec.id}`,
    tenantId,
    supplierProductId: `supplier-product-${spec.id}`,
    minQuantity: 1,
    unitCost: spec.cost,
  })),
};

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function ean13(sequence: number): string {
  const base = `7401234${String(sequence).padStart(5, "0")}`;
  const sum = [...base].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${base}${(10 - (sum % 10)) % 10}`;
}

function locationForCategory(categoryId: string): string {
  return ["cat-power-tools", "cat-construction", "cat-garden"].includes(categoryId)
    ? "loc-centro-b"
    : "loc-centro-a";
}
