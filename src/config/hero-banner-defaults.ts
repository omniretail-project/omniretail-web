import { BusinessPreset } from "@/core/enums";

export interface HeroBannerSlideText {
  title: string;
  description: string;
}

type HeroBannerDefaults = Record<Exclude<BusinessPreset, BusinessPreset.custom>, HeroBannerSlideText[]>;

export const heroBannerPresetLabels: Record<Exclude<BusinessPreset, BusinessPreset.custom>, string> = {
  [BusinessPreset.hardware_store]: "Ferretería",
  [BusinessPreset.pharmacy]: "Farmacia",
  [BusinessPreset.grocery]: "Abarrotería",
  [BusinessPreset.services]: "Servicios",
};

export const heroBannerDefaultsConfig: HeroBannerDefaults = {
  [BusinessPreset.hardware_store]: [
    {
      title: "Herramientas de alto rendimiento",
      description:
        "Equipamiento industrial para contratistas, talleres y constructoras con precios escalonados por volumen.",
    },
    {
      title: "Todo para construir con confianza",
      description: "Encuentra herramientas, fijación y suministros para cada etapa de tu obra.",
    },
    {
      title: "Calidad que impulsa tu trabajo",
      description:
        "Productos seleccionados para profesionales que buscan disponibilidad y rendimiento.",
    },
  ],
  [BusinessPreset.pharmacy]: [
    {
      title: "Tu salud, siempre al alcance",
      description: "Medicamentos y productos de cuidado personal con atención cercana y confiable.",
    },
    {
      title: "Bienestar para toda la familia",
      description: "Encuentre lo que necesita, con asesoría profesional.",
    },
    {
      title: "Disponibilidad en la que puede confiar",
      description: "Stock actualizado de productos de confianza, siempre a tiempo.",
    },
  ],
  [BusinessPreset.grocery]: [
    {
      title: "Frescura todos los días",
      description: "Productos de despensa y consumo diario al mejor precio para tu hogar.",
    },
    {
      title: "Todo para tu mesa",
      description: "Abarrotes, frescos y más, seleccionados pensando en tu familia.",
    },
    {
      title: "Ahorra en tu compra de siempre",
      description: "Ofertas y precios especiales en los productos más solicitados.",
    },
  ],
  [BusinessPreset.services]: [
    {
      title: "Servicios profesionales a tu medida",
      description: "Soluciones confiables, agendadas fácilmente y con seguimiento cercano.",
    },
    {
      title: "Experiencia en la que puede confiar",
      description: "Profesionales calificados listos para resolver sus necesidades.",
    },
    {
      title: "Atención personalizada",
      description: "Coordine el servicio y reciba acompañamiento en cada etapa.",
    },
  ],
};
