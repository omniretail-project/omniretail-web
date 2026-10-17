import Link from "next/link";

export default function LandingFooter() {
  return (
    <footer className="bg-[var(--mkt-primary)] py-16 text-white">
      <div className="mx-auto max-w-[1140px] px-6">
        <div className="flex flex-col justify-between gap-10 md:flex-row">
          <div><Link className="flex items-center gap-3 text-xl font-extrabold" href="/"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--mkt-accent)] shadow">M</span>MARJYM</Link><p className="mt-4 max-w-sm text-sm leading-6 text-white/65">Todo tu negocio conectado en un solo lugar. Una operación comercial clara, segura y lista para crecer.</p></div>
          <nav className="flex flex-wrap gap-x-8 gap-y-4 text-sm font-semibold text-white/75"><Link className="hover:text-white" href="/">Inicio</Link><Link className="hover:text-white" href="/#funcionalidades">Funcionalidades</Link><Link className="hover:text-white" href="/#como-funciona">Cómo funciona</Link><Link className="hover:text-white" href="/#precios">Precios</Link><Link className="hover:text-white" href="/#faq">FAQ</Link></nav>
        </div>
        <div className="mt-12 border-t border-white/15 pt-8 text-sm text-white/50">© {new Date().getFullYear()} MARJYM. Todos los derechos reservados.</div>
      </div>
    </footer>
  );
}
