export default function LandingFaq() {
  const faqs = [
    {
      question: "¿Qué incluye MARJYM Base?",
      answer: "El plan Base incluye todas las herramientas esenciales para operar: gestión de inventario, compras, recepciones de mercadería y el módulo de Punto de Venta."
    },
    {
      question: "¿Puedo agregar E-commerce después?",
      answer: "Sí. Puedes iniciar con el plan Base y agregar el complemento de E-commerce + Entregas más adelante, cuando tu negocio esté listo para vender en línea."
    },
    {
      question: "¿Puedo agregar Reportes avanzados después?",
      answer: "Sí, el complemento de Reportes avanzados se puede activar en cualquier momento para obtener mayor profundidad en el análisis de tus ventas e inventario."
    },
    {
      question: "¿Puedo controlar productos por lotes, vencimientos o números de serie?",
      answer: "Sí. La trazabilidad completa por lotes, fechas de vencimiento y números de serie está incluida dentro de MARJYM Base, sin costo adicional."
    },
    {
      question: "¿Puedo trabajar con varias sucursales?",
      answer: "Sí. El sistema permite gestionar múltiples sucursales de manera centralizada desde una sola cuenta."
    },
    {
      question: "¿Necesito instalar MARJYM?",
      answer: "No. MARJYM funciona 100% en la nube, por lo que puedes acceder desde cualquier navegador web sin necesidad de instalar programas en tu computadora."
    },
    {
      question: "¿Se realiza un cobro automático al contratar?",
      answer: "No. El proceso de contratación no realiza ningún cargo automático a tu tarjeta en este momento. Podrás configurar tus métodos de pago más adelante de forma segura."
    }
  ];

  return (
    <section id="faq" className="border-t border-[var(--mkt-border-light)] bg-[var(--mkt-surface)] py-16 md:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="mb-4 text-3xl font-bold text-[var(--mkt-primary)] md:text-4xl">
            Preguntas frecuentes
          </h2>
          <p className="text-lg text-[var(--mkt-muted)]">
            Resuelve tus dudas sobre MARJYM y descubre cómo podemos ayudar a tu negocio.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, idx) => (
            <details
              key={idx}
              className="group rounded-xl border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between p-5 font-semibold text-[var(--mkt-primary)]">
                {faq.question}
                <span className="relative ml-4 shrink-0">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="absolute inset-0 w-5 h-5 opacity-100 group-open:opacity-0 transition-opacity"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5 opacity-0 group-open:opacity-100 transition-opacity"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                  </svg>
                </span>
              </summary>
              <div className="px-5 pb-5 leading-relaxed text-[var(--mkt-muted)]">
                {faq.answer}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
