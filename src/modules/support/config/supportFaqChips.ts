/**
 * Preguntas frecuentes de respuesta fija para el widget de soporte
 * (chips, no lenguaje libre -- no hay backend/IA real en este proyecto).
 *
 * PLACEHOLDER: estas 4 preguntas/respuestas son inventadas por Claude
 * únicamente para que el panel no quede vacío antes de la revisión.
 * Reemplazar por las preguntas y respuestas reales del negocio antes de
 * mostrar esto a clientes reales -- mismo criterio que los placeholders
 * de Soporte que se corrigieron en PR12 (nunca mostrar datos inventados
 * como si fueran reales).
 */
export interface SupportFaqChip {
  id: string;
  question: string;
  answer: string;
}

export const SUPPORT_FAQ_CHIPS: SupportFaqChip[] = [
  {
    id: "shipping",
    question: "¿Cuánto tarda el envío?",
    answer: "Consulte al negocio para conocer los tiempos de envío disponibles.",
  },
  {
    id: "returns",
    question: "¿Cómo hago un cambio o devolución?",
    answer: "Consulte al negocio para conocer las condiciones de cambios y devoluciones.",
  },
  {
    id: "payment-methods",
    question: "¿Qué métodos de pago aceptan?",
    answer: "Los métodos de pago disponibles se muestran al finalizar la compra.",
  },
  {
    id: "hours",
    question: "¿Cuál es el horario de atención?",
    answer: "Consulte al negocio para conocer el horario de atención.",
  },
];
