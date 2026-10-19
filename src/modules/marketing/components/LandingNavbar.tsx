import Link from "next/link";
import { getPublicDemoUrl } from "@/config/demo-mode";

const links = [
  ["Inicio", "/"],
  ["Funcionalidades", "/#funcionalidades"],
  ["Módulos", "/#modulos"],
  ["Cómo funciona", "/#como-funciona"],
  ["Precios", "/#precios"],
  ["FAQ", "/#faq"],
] as const;

export default function LandingNavbar() {
  const demoUrl = getPublicDemoUrl();
  const demoLoginUrl = demoUrl ? `${demoUrl}/iniciar-sesion` : "";
  return (
    <header className="sticky top-0 z-50 border-b border-[rgba(157,184,255,.3)] bg-[rgba(255,244,214,.9)] py-4 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1140px] items-center justify-between gap-6 px-6">
        <Link className="flex items-center gap-3 text-[1.4rem] font-extrabold tracking-[-.02em] text-[var(--mkt-primary)]" href="/">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--mkt-accent)] text-lg font-bold text-white shadow-[0_4px_10px_rgba(47,103,231,.3)]">M</span>
          MARJYM
        </Link>
        <nav className="hidden items-center gap-6 xl:flex">
          {/* "Inicio" se omite en escritorio: el logo ya enlaza al inicio y libera espacio. */}
          {links.filter(([, href]) => href !== "/").map(([label, href]) => <Link className="whitespace-nowrap text-[.95rem] font-semibold text-[var(--mkt-primary)] transition hover:text-[var(--mkt-accent)]" href={href} key={href}>{label}</Link>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Link className="whitespace-nowrap px-2 py-3 text-sm font-semibold text-[var(--mkt-primary)] hover:text-[var(--mkt-accent)]" href="/iniciar-sesion">Iniciar sesión</Link>
          {demoLoginUrl ? <a className="whitespace-nowrap px-2 py-3 text-sm font-semibold text-[var(--mkt-primary)] hover:text-[var(--mkt-accent)]" href={demoLoginUrl} rel="noopener noreferrer" target="_blank">Probar demo</a> : null}
          <Link className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md bg-[var(--mkt-accent)] px-6 text-sm font-semibold text-white shadow-[0_4px_6px_rgba(47,103,231,.25)] transition hover:-translate-y-px hover:bg-[var(--mkt-accent-hover)]" href="/solicitar-informacion">Solicitar información</Link>
        </div>
        <details className="group relative xl:hidden">
          <summary aria-label="Abrir navegación" className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--mkt-border)] text-[var(--mkt-primary)]">☰</summary>
          <nav className="absolute right-0 top-14 flex w-60 flex-col gap-1 rounded-xl border border-[var(--mkt-border-light)] bg-white p-3 shadow-lg">
            {links.map(([label, href]) => <Link className="rounded-md px-3 py-2 text-sm font-semibold text-[var(--mkt-primary)] hover:bg-[var(--mkt-accent-light)]" href={href} key={href}>{label}</Link>)}
            <hr className="my-1 border-[var(--mkt-border-light)] md:hidden" />
            <Link className="rounded-md px-3 py-2 text-sm font-semibold text-[var(--mkt-primary)] md:hidden" href="/iniciar-sesion">Iniciar sesión</Link>
            {demoLoginUrl ? <a className="rounded-md px-3 py-2 text-sm font-semibold text-[var(--mkt-primary)] md:hidden" href={demoLoginUrl} rel="noopener noreferrer" target="_blank">Probar demo</a> : null}
            <Link className="rounded-md bg-[var(--mkt-accent)] px-3 py-2 text-center md:hidden text-sm font-semibold text-white" href="/solicitar-informacion">Solicitar información</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
