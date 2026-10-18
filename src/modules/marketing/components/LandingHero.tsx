import Link from "next/link";
import { getPublicDemoUrl } from "@/config/demo-mode";

const navIcons = ["⌂", "▦", "▤", "◎"];
const stats = [["Ventas del mes", "Q 48,750", "↑ 12.5%"], ["Órdenes activas", "24", "↑ 8.1%"], ["Alertas stock", "7", "↓ 3.2%"]];
const orders = [["ORD-1045", "Pagado", "Q 1,250.00"], ["WEB-0082", "Pendiente envío", "Q 490.50"], ["ORD-1044", "Pagado", "Q 85.00"]];

export default function LandingHero() {
  const demoUrl = getPublicDemoUrl();
  return (
    <section className="relative overflow-hidden bg-[var(--mkt-bg)] py-20 lg:py-[80px] lg:pb-[120px]">
      <div className="pointer-events-none absolute -right-24 -top-24 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(47,103,231,.06),transparent_70%)]" />
      <div className="relative mx-auto grid max-w-[1140px] items-center gap-[60px] px-6 lg:grid-cols-2">
        <div>
          <span className="inline-flex rounded-full border border-[var(--mkt-border-light)] bg-[var(--mkt-accent-light)] px-3 py-1 text-xs font-bold uppercase tracking-[.05em] text-[var(--mkt-accent)]">Gestión comercial conectada</span>
          <h1 className="mt-5 text-[2.8rem] font-extrabold leading-[1.08] tracking-[-.03em] text-[var(--mkt-primary)] sm:text-[3.4rem] lg:text-[3.8rem]">Todo tu negocio <span className="text-[var(--mkt-accent)]">conectado</span> en un solo lugar.</h1>
          <p className="mt-6 max-w-[520px] text-lg leading-[1.6] text-[var(--mkt-muted)] sm:text-xl">Inventario, compras, recepciones y punto de venta trabajando juntos para que operes con claridad y hagas crecer tu negocio.</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-md bg-[var(--mkt-accent)] px-5 font-semibold text-white shadow-[0_4px_6px_rgba(47,103,231,.25)] transition hover:-translate-y-px hover:bg-[var(--mkt-accent-hover)]" href="/solicitar-informacion">Solicitar información</Link>
            <Link className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-md border border-[var(--mkt-border)] bg-white px-5 font-semibold text-[var(--mkt-primary)] shadow-sm hover:bg-[var(--mkt-bg-alt)]" href="/iniciar-sesion">Iniciar sesión</Link>
            {demoUrl ? <a className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-md border border-[var(--mkt-border)] bg-white px-5 font-semibold text-[var(--mkt-primary)] shadow-sm hover:bg-[var(--mkt-bg-alt)]" href={`${demoUrl}/iniciar-sesion`} rel="noopener noreferrer" target="_blank">Probar demo</a> : null}
          </div>
        </div>
        <div className="relative mx-auto h-[360px] w-full max-w-[560px] [perspective:1200px] sm:h-[415px]">
          <div className="absolute inset-y-3 left-0 flex w-full origin-center overflow-hidden rounded-xl border border-[var(--mkt-border-light)] bg-[var(--mkt-bg)] shadow-[0_20px_25px_-5px_rgba(47,103,231,.1),0_8px_10px_-6px_rgba(47,103,231,.05)] transition-transform duration-500 motion-reduce:transition-none lg:right-0 lg:left-auto lg:w-[600px] lg:[transform:rotateY(-10deg)_rotateX(3deg)] lg:hover:[transform:rotateY(-3deg)_rotateX(1deg)]">
            <aside className="flex w-14 shrink-0 flex-col items-center gap-4 bg-[var(--mkt-sidebar)] pt-4 sm:w-16 sm:gap-5 sm:pt-5">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-white font-extrabold text-[var(--mkt-accent)] shadow">M</span>
              {navIcons.map((icon, index) => <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm ${index === 0 ? "bg-white text-[var(--mkt-accent)]" : "bg-white/10 text-white/70"}`} key={icon}>{icon}</span>)}
            </aside>
            <div className="min-w-0 flex-1">
              <div className="flex h-14 items-center justify-between border-b border-[var(--mkt-border-light)] bg-white px-4 sm:px-6"><strong className="truncate text-sm text-[var(--mkt-primary)] sm:text-base">Resumen de Organización</strong><div className="flex items-center gap-2"><span className="hidden text-xs text-[var(--mkt-muted)] sm:inline">Carlos (Admin)</span><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mkt-accent-light)] text-xs font-bold text-[var(--mkt-accent)]">CA</span></div></div>
              <div className="flex h-[calc(100%-56px)] flex-col gap-3 overflow-hidden p-3 sm:gap-5 sm:p-6">
                <div className="grid grid-cols-3 gap-2 sm:gap-5">{stats.map(([label, value, trend], index) => <div className="relative overflow-hidden rounded-xl border border-[var(--mkt-border-light)] bg-white p-3 shadow-sm sm:p-4" key={label}><span className={`absolute inset-y-0 left-0 w-1 ${index === 0 ? "bg-[var(--mkt-accent)]" : "bg-[var(--mkt-border-light)]"}`} /><p className="truncate text-[8px] font-bold uppercase tracking-wide text-[var(--mkt-muted)] sm:text-[11px]">{label}</p><p className="mt-2 text-sm font-extrabold text-[var(--mkt-primary)] sm:text-[22px]">{value}</p><p className={`mt-1 text-[8px] font-semibold sm:text-[10px] ${index === 2 ? "text-[var(--mkt-error)]" : "text-[var(--mkt-success)]"}`}>{trend}</p></div>)}</div>
                <div className="flex-1 overflow-hidden rounded-xl border border-[var(--mkt-border-light)] bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-[var(--mkt-border-light)] bg-slate-50 px-4 py-3 text-xs font-bold text-[var(--mkt-primary)] sm:px-5 sm:text-sm"><span>Transacciones recientes</span><span className="text-[var(--mkt-accent)]">Ver todas</span></div>
                  {orders.map(([id, state, amount]) => <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-[var(--mkt-border-light)] px-4 py-3 text-[9px] last:border-0 sm:px-5 sm:text-xs" key={id}><strong className="text-[var(--mkt-text)]">{id}</strong><span className={`w-fit rounded-md px-2 py-1 font-bold ${state === "Pagado" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{state}</span><strong className="text-right text-[var(--mkt-text)]">{amount}</strong></div>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
