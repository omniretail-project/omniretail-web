const essentials = [
  ["▦", "Inventario", "Existencias, movimientos y trazabilidad por lotes, vencimientos o series."],
  ["⌁", "Compras y recepciones", "Órdenes, proveedores y recepción de mercadería conectados al inventario."],
  ["▤", "Punto de venta", "Una experiencia de caja ágil, clara y conectada con tu catálogo."],
  ["◎", "Control centralizado", "La información operativa de tus sucursales disponible en un solo lugar."],
];
const businesses = [["🔧", "Ferreterías", "Catálogo amplio, precios e inventario controlado."], ["✚", "Farmacias", "Lotes, vencimientos y trazabilidad precisa."], ["▣", "Abarroterías", "Compras, existencias y venta rápida."], ["◇", "Servicios", "Una base flexible para organizar tu operación."]];
const flow = [["01", "Registre el negocio"], ["02", "Cree la cuenta propietaria"], ["03", "Configure el entorno"], ["04", "Confirme la información de pago"], ["05", "Confirme y cree el espacio"]];
const modules = [
  ["▦", "Inventario y alertas", "Existencias y alertas para mantener el control operativo."],
  ["▤", "Catálogo y precios", "Productos, categorías y precios organizados para vender."],
  ["⌁", "Compras y proveedores", "Abastecimiento y proveedores en un flujo conectado."],
  ["✓", "Recepciones", "Ingreso de mercadería con trazabilidad desde la compra."],
  ["▣", "Punto de venta", "Ventas rápidas conectadas a tu catálogo e inventario."],
  ["◇", "Picking y despachos", "Complemento opcional para entregas y pedidos digitales."],
  ["◎", "Sucursales", "Operación centralizada para tus diferentes ubicaciones."],
  ["◫", "Tienda en línea", "Complemento opcional: E-commerce + Entregas."],
  ["◌", "Reportes avanzados", "Complemento opcional para análisis más profundo."],
];

export default function LandingFeatures() {
  return (
    <>
      <section className="border-y border-[var(--mkt-border-light)] bg-white py-[100px]" id="funcionalidades">
        <div className="mx-auto max-w-[1140px] px-6">
          <div className="text-center"><span className="inline-flex rounded-full border border-[var(--mkt-border-light)] bg-[var(--mkt-accent-light)] px-3 py-1 text-xs font-bold uppercase tracking-[.05em] text-[var(--mkt-accent)]">Operación conectada</span><h2 className="mt-4 text-3xl font-extrabold tracking-[-.02em] text-[var(--mkt-primary)] md:text-[2.5rem]">Lo esencial de tu negocio, en el mismo lugar</h2><p className="mx-auto mt-4 max-w-[700px] text-lg leading-7 text-[var(--mkt-muted)]">Las herramientas diarias trabajan juntas para darte una operación más ordenada y visible.</p></div>
          <div className="mt-[60px] grid gap-8 sm:grid-cols-2 lg:grid-cols-4">{essentials.map(([icon, title, copy]) => <article className="flex flex-col gap-4" key={title}><span className="flex h-[52px] w-[52px] items-center justify-center rounded-xl border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] text-[28px] text-[var(--mkt-accent)] shadow-sm">{icon}</span><h3 className="text-lg font-bold text-[var(--mkt-primary)]">{title}</h3><p className="text-[.95rem] leading-[1.6] text-[var(--mkt-muted)]">{copy}</p></article>)}</div>
        </div>
      </section>

      <section className="bg-white py-[120px]" id="modulos">
        <div className="mx-auto max-w-[1140px] px-6"><div className="text-center"><h2 className="text-3xl font-extrabold tracking-[-.02em] text-[var(--mkt-primary)] md:text-[2.5rem]">Módulos que trabajan contigo</h2><p className="mx-auto mt-4 max-w-[700px] text-lg text-[var(--mkt-muted)]">MARJYM conecta las áreas del negocio en una misma operación.</p></div><div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">{modules.map(([icon, title, copy]) => <article className="group rounded-[20px] border border-[var(--mkt-border-light)] bg-white p-8 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-[var(--mkt-border)] hover:shadow-[0_20px_25px_-5px_rgba(47,103,231,.1)] motion-reduce:transform-none motion-reduce:transition-none" key={title}><span className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[var(--mkt-accent-light)] text-[28px] text-[var(--mkt-accent)] transition group-hover:bg-[var(--mkt-accent)] group-hover:text-white">{icon}</span><h3 className="mt-5 text-xl font-bold text-[var(--mkt-primary)]">{title}</h3><p className="mt-3 text-[.95rem] leading-6 text-[var(--mkt-muted)]">{copy}</p>{copy.includes("Complemento opcional") ? <p className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--mkt-accent)]">Complemento opcional</p> : null}</article>)}</div></div>
      </section>

      <section className="bg-[var(--mkt-bg-alt)] py-[120px]">
        <div className="mx-auto max-w-[1140px] px-6">
          <div className="text-center"><h2 className="text-3xl font-extrabold tracking-[-.02em] text-[var(--mkt-primary)] md:text-[2.5rem]">MARJYM se adapta al tipo de negocio</h2><p className="mx-auto mt-4 max-w-[700px] text-lg text-[var(--mkt-muted)]">Una presentación inicial pensada para comercios con necesidades distintas, sin perder una experiencia coherente.</p></div>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">{businesses.map(([icon, title, copy]) => <article className="rounded-[20px] border border-[var(--mkt-border-light)] bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:border-[var(--mkt-border)] hover:shadow-lg motion-reduce:transform-none" key={title}><span className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[var(--mkt-accent-light)] text-[28px] text-[var(--mkt-accent)]">{icon}</span><h3 className="mt-5 text-xl font-bold text-[var(--mkt-primary)]">{title}</h3><p className="mt-3 text-[.95rem] leading-6 text-[var(--mkt-muted)]">{copy}</p></article>)}</div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[var(--mkt-primary)] py-[120px] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(47,103,231,.25),transparent_60%)]" />
        <div className="relative mx-auto grid max-w-[1140px] items-center gap-16 px-6 lg:grid-cols-2 lg:gap-20">
          <div><span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wide">Datos protegidos</span><h2 className="mt-5 text-3xl font-extrabold tracking-[-.02em] md:text-[2.5rem]">Cada organización, en su propio espacio</h2><p className="mt-5 text-lg leading-[1.6] text-white/70">MARJYM separa la operación de cada negocio para que su catálogo, inventario y actividad se mantengan dentro de su organización.</p><ul className="mt-8 space-y-4 text-white/80">{["Información separada por organización", "Roles y permisos para tu equipo", "Sucursales y recursos bajo un mismo entorno"].map((item) => <li className="flex gap-4" key={item}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10 text-[var(--mkt-accent)]">✓</span>{item}</li>)}</ul></div>
          <div className="space-y-8 rounded-[20px] border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-12">
            {[["Ferretería Los Altos", ["Inventario privado", "Ventas y clientes", "Sucursales conectadas"]], ["Farmacia La Salud", ["Lotes y vencimientos", "Operación independiente"]]].map(([name, items], index) => <article className={`rounded-xl bg-white p-6 text-[var(--mkt-primary)] shadow-[0_10px_25px_rgba(0,0,0,.2)] ${index ? "ml-7 scale-95 opacity-60" : "border-2 border-[var(--mkt-accent)]"}`} key={name as string}><h3 className="flex items-center gap-3 text-lg font-extrabold"><span className="h-3 w-3 rounded-full bg-[var(--mkt-accent)]" />{name as string}</h3><div className="ml-1 mt-5 space-y-3 border-l-2 border-[var(--mkt-border-light)] pl-5 text-sm text-[var(--mkt-muted)]">{(items as string[]).map((item) => <p key={item}>▦ {item}</p>)}</div></article>)}
          </div>
        </div>
      </section>

      <section className="bg-white py-[110px]" id="como-funciona">
        <div className="mx-auto max-w-[1140px] px-6 text-center"><span className="inline-flex rounded-full border border-[var(--mkt-border-light)] bg-[var(--mkt-accent-light)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--mkt-accent)]">Contratación guiada</span><h2 className="mt-4 text-3xl font-extrabold text-[var(--mkt-primary)] md:text-[2.5rem]">Tu espacio listo en cinco pasos</h2><div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">{flow.map(([number, title], index) => <article className="group rounded-xl border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] p-6 text-left transition duration-200 hover:-translate-y-1 hover:border-[var(--mkt-accent)] hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none" key={number}><span className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[var(--mkt-accent-light)] text-[28px] text-[var(--mkt-accent)] transition group-hover:bg-[var(--mkt-accent)] group-hover:text-white">{["⌂", "◯", "⚙", "▭", "✓"][index]}</span><span className="mt-5 block text-3xl font-extrabold text-[var(--mkt-accent)]">{number}</span><h3 className="mt-3 font-bold leading-6 text-[var(--mkt-primary)]">{title}</h3><p className="mt-2 text-sm leading-5 text-[var(--mkt-muted)]">Un paso claro dentro de tu contratación.</p></article>)}</div></div>
      </section>
    </>
  );
}
