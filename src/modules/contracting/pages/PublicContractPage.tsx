"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { EMPLOYEE_PASSWORD_POLICY, getPasswordRequirementsMessage } from "@/config/auth-policy";
import { BASE_MONTHLY_QUETZALES, SUBSCRIPTION_ADDONS } from "@/core/subscription/catalog";
import { BusinessPreset } from "@/core/enums";
import { usePublicContract } from "@/modules/contracting/hooks/usePublicContract";
import LandingNavbar from "@/modules/marketing/components/LandingNavbar";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { PasswordInput } from "@/shared/components/PasswordInput";

const price = `Q${BASE_MONTHLY_QUETZALES.toFixed(2)}`;
const passwordHint = getPasswordRequirementsMessage(EMPLOYEE_PASSWORD_POLICY);
const steps = ["Negocio", "Propietario", "Entorno", "Plan y pago", "Confirmar"];
const capabilities = ["Catálogo e inventario", "Compras y recepciones", "Punto de venta", "Trazabilidad"];
type PaymentStatus = "idle" | "processing" | "approved";
const presetOptions = [
  [BusinessPreset.hardware_store, "Ferretería"],
  [BusinessPreset.pharmacy, "Farmacia"],
  [BusinessPreset.grocery, "Abarrotería"],
  [BusinessPreset.services, "Servicios"],
  [BusinessPreset.custom, "Personalizado"],
] as const;
const subscribeToOrigin = () => () => {};

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "mi-negocio";
}

function expiryIsValid(value: string) {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

export function PublicContractPage() {
  const contract = usePublicContract();
  const { values, setField, fieldErrors, formError, isSubmitting, completedBusinessName, businessPreset, setBusinessPreset, submit } = contract;
  const [step, setStep] = useState(1);
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    () => window.location.origin,
    () => "",
  );
  const [notice, setNotice] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [holder, setHolder] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("idle");
  const [paymentError, setPaymentError] = useState<string>();
  const [maskedCard, setMaskedCard] = useState("");
  const previewSlug = useMemo(() => slugify(values.businessName), [values.businessName]);
  const storefrontUrl = `${origin}/tienda/${previewSlug}`;

  function next() {
    if (step === 1 && (!values.businessName.trim() || !businessPreset)) return setNotice("Ingresa el nombre comercial y selecciona el rubro principal.");
    if (step === 2 && (!values.adminName.trim() || !values.adminEmail.trim() || !values.adminPassword || !values.confirmPassword)) return setNotice("Completa los datos del propietario para continuar.");
    if (step === 2 && values.adminPassword !== values.confirmPassword) return setNotice("Las contraseñas deben coincidir.");
    if (step === 4 && paymentStatus !== "approved") return setNotice("Complete y confirme la información de pago para continuar.");
    setNotice(undefined);
    setStep((current) => Math.min(current + 1, 5));
  }

  function simulatePayment() {
    const digits = cardNumber.replace(/\D/g, "");
    if (!holder.trim() || digits.length < 13 || digits.length > 19 || !expiryIsValid(expiry) || !/^\d{3,4}$/.test(cvv)) {
      setPaymentError("Revisa el titular, número de tarjeta, vencimiento y CVV.");
      return;
    }
    setPaymentError(undefined);
    setPaymentStatus("processing");
    const lastFour = digits.slice(-4);
    window.setTimeout(() => {
      setMaskedCard(`•••• ${lastFour}`);
      setCardNumber("");
      setExpiry("");
      setCvv("");
      setPaymentStatus("approved");
    }, 750);
  }

  const inputClass = "h-12 rounded-md border-[var(--mkt-border)] bg-white focus:border-[var(--mkt-accent)] focus:ring-[var(--mkt-accent)]/25";

  if (completedBusinessName) return (
    <>
      <LandingNavbar />
      <main className="min-h-[calc(100vh-77px)] bg-[var(--mkt-bg)] px-5 py-[60px]">
        <section className="mx-auto max-w-[680px] rounded-[20px] border border-[var(--mkt-border-light)] bg-white p-8 text-center shadow-[0_20px_25px_-5px_rgba(47,103,231,.1)] sm:p-12">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl font-bold text-[var(--mkt-success)]">✓</span>
          <h1 className="mt-6 text-3xl font-extrabold text-[var(--mkt-primary)]">¡Tu espacio en MARJYM está listo!</h1>
          <p className="mt-3 text-[var(--mkt-muted)]">El entorno de <strong className="text-[var(--mkt-primary)]">{completedBusinessName}</strong> fue creado correctamente.</p>
          <div className="mt-8 rounded-xl border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] p-6 text-left">
            {[["Plan", `MARJYM Base — ${price}/mes`], ["Administrador", values.adminEmail], ["Dirección local", storefrontUrl]].map(([label, value]) => <div className="mb-4 last:mb-0" key={label}><p className="text-xs font-bold uppercase tracking-wide text-[var(--mkt-muted)]">{label}</p><p className="mt-1 break-all font-semibold text-[var(--mkt-primary)]">{value}</p></div>)}
          </div>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><button className="rounded-md border border-[var(--mkt-border)] px-6 py-3 font-semibold text-[var(--mkt-primary)] hover:bg-[var(--mkt-bg-alt)]" onClick={() => { void navigator.clipboard?.writeText(storefrontUrl); setCopied(true); }} type="button">{copied ? "URL copiada" : "Copiar URL"}</button><Link className="rounded-md bg-[var(--mkt-accent)] px-6 py-3 font-semibold text-white hover:bg-[var(--mkt-accent-hover)]" href="/iniciar-sesion">Ir a iniciar sesión</Link></div>
        </section>
      </main>
    </>
  );

  return (
    <>
      <LandingNavbar />
      <main className="min-h-[calc(100vh-77px)] bg-[var(--mkt-bg)] px-4 py-[60px] sm:px-6">
        <section className="mx-auto max-w-[800px] rounded-[20px] border border-[var(--mkt-border-light)] bg-white p-6 shadow-[0_10px_15px_-3px_rgba(14,35,64,.08)] sm:p-12">
          <header className="text-center"><span className="inline-flex rounded-full border border-[var(--mkt-border-light)] bg-[var(--mkt-accent-light)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--mkt-accent)]">MARJYM Base · {price}/mes</span><h1 className="mt-4 text-3xl font-extrabold tracking-[-.02em] text-[var(--mkt-primary)]">Crea tu entorno empresarial</h1><p className="mt-3 text-[var(--mkt-muted)]">Aprovisionamiento automatizado de tu organización en MARJYM.</p></header>
          <ol className="mt-10 flex items-start justify-between" aria-label="Pasos de contratación">
            {steps.map((label, index) => { const number = index + 1; const done = number < step; const active = number === step; return <li className="relative flex min-w-0 flex-1 flex-col items-center text-center" key={label}>{number < 5 ? <span className="absolute left-[60%] top-[18px] h-px w-[80%] bg-[var(--mkt-border-light)]" /> : null}<span className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold ${done || active ? "border-[var(--mkt-accent)] bg-[var(--mkt-accent)] text-white" : "border-[var(--mkt-border)] bg-white text-[var(--mkt-muted)]"}`}>{done ? "✓" : number}</span><span className={`mt-2 hidden text-[10px] font-bold uppercase tracking-wide sm:block ${done || active ? "text-[var(--mkt-primary)]" : "text-[var(--mkt-muted)]"}`}>{label}</span></li>; })}
          </ol>

          {isSubmitting ? <div className="mx-auto my-16 max-w-md text-center"><div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-[var(--mkt-border-light)] border-t-[var(--mkt-accent)]" /><h2 className="mt-6 text-2xl font-bold text-[var(--mkt-primary)]">Preparando tu espacio de negocio</h2><div className="mx-auto mt-6 max-w-xs space-y-2 rounded-xl bg-[var(--mkt-bg-alt)] p-5 text-left text-sm text-[var(--mkt-muted)]"><p>✓ Información validada</p><p>✓ Plan Base preparado</p><p>• Creando espacio</p><p>• Preparando acceso administrativo</p></div></div> : (
            <form className="mt-10" noValidate onSubmit={(event) => { event.preventDefault(); if (step === 5) void submit(); }}>
              {formError ? <InlineAlert className="mb-6" title={formError} tone="danger" /> : null}{notice ? <InlineAlert className="mb-6" title={notice} tone="danger" /> : null}

              {step === 1 ? <div className="space-y-6"><div><h2 className="text-xl font-bold text-[var(--mkt-primary)]">Datos del negocio</h2><p className="mt-2 text-sm text-[var(--mkt-muted)]">Defina la identidad principal de la organización.</p></div><FormField error={fieldErrors.businessName} id="business-name" label="Nombre comercial de la organización"><Input autoComplete="organization" className={inputClass} id="business-name" maxLength={120} onChange={(event) => setField("businessName", event.target.value)} placeholder="Ej: Ferretería Los Altos" value={values.businessName} /></FormField><div className="space-y-1.5"><label className="block text-sm font-semibold text-[var(--mkt-text)]" htmlFor="business-preset">Rubro comercial principal</label><select className="h-12 w-full rounded-md border border-[var(--mkt-border)] bg-white px-3 text-sm text-[var(--mkt-text)] outline-none focus:border-[var(--mkt-accent)] focus:ring-2 focus:ring-[var(--mkt-accent)]/25" id="business-preset" onChange={(event) => setBusinessPreset(event.target.value as BusinessPreset)} value={businessPreset ?? ""}><option disabled value="">Seleccione un rubro</option>{presetOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div> : null}

              {step === 2 ? <div className="space-y-6"><div><h2 className="text-xl font-bold text-[var(--mkt-primary)]">Cuenta propietaria</h2><p className="mt-2 text-sm text-[var(--mkt-muted)]">Esta persona administrará inicialmente el entorno.</p></div><FormField error={fieldErrors.adminName} id="admin-name" label="Nombre completo"><Input autoComplete="name" className={inputClass} id="admin-name" maxLength={120} onChange={(event) => setField("adminName", event.target.value)} value={values.adminName} /></FormField><FormField error={fieldErrors.adminEmail} id="admin-email" label="Correo electrónico"><Input autoComplete="email" className={inputClass} id="admin-email" maxLength={254} onChange={(event) => setField("adminEmail", event.target.value)} placeholder="admin@empresa.com" type="email" value={values.adminEmail} /></FormField><div className="grid gap-6 sm:grid-cols-2"><FormField error={fieldErrors.adminPassword} hint={passwordHint} id="admin-password" label="Contraseña"><PasswordInput autoComplete="new-password" className={inputClass} id="admin-password" maxLength={EMPLOYEE_PASSWORD_POLICY.MAX_LENGTH} onChange={(event) => setField("adminPassword", event.target.value)} value={values.adminPassword} /></FormField><FormField error={fieldErrors.confirmPassword} id="confirm-password" label="Confirmar contraseña"><PasswordInput autoComplete="new-password" className={inputClass} id="confirm-password" maxLength={EMPLOYEE_PASSWORD_POLICY.MAX_LENGTH} onChange={(event) => setField("confirmPassword", event.target.value)} value={values.confirmPassword} /></FormField></div></div> : null}

              {step === 3 ? <div><h2 className="text-xl font-bold text-[var(--mkt-primary)]">Configura tu entorno</h2><p className="mt-2 text-sm text-[var(--mkt-muted)]">La dirección se genera automáticamente. No necesitas configurarla.</p><div className="mt-7 rounded-xl border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] p-6"><p className="text-xs font-bold uppercase tracking-wide text-[var(--mkt-muted)]">Tu entorno MARJYM</p><p className="mt-2 text-sm font-semibold text-[var(--mkt-primary)]">Dirección local de la tienda</p><p className="mt-3 break-all rounded-md border border-[var(--mkt-border-light)] bg-white p-4 font-bold text-[var(--mkt-accent)]">{storefrontUrl}</p><p className="mt-4 text-sm text-[var(--mkt-muted)]">ⓘ Vista previa de solo lectura basada en el nombre del negocio.</p></div></div> : null}

              {step === 4 ? <div className="space-y-7"><div><h2 className="text-xl font-bold text-[var(--mkt-primary)]">Plan e información de pago</h2><p className="mt-2 text-sm text-[var(--mkt-muted)]">Revise la información antes de confirmar la contratación.</p></div><div className="rounded-xl border-2 border-[var(--mkt-accent)] bg-[var(--mkt-accent-light)] p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-wide text-[var(--mkt-accent)]">Plan seleccionado</p><h3 className="mt-1 text-2xl font-extrabold text-[var(--mkt-primary)]">MARJYM Base</h3></div><p className="text-3xl font-extrabold text-[var(--mkt-primary)]">{price}<span className="text-sm font-medium text-[var(--mkt-muted)]"> / mes</span></p></div><ul className="mt-5 grid gap-2 text-sm text-[var(--mkt-text)] sm:grid-cols-2">{capabilities.map((item) => <li key={item}>✓ {item}</li>)}</ul></div>
                <div className="rounded-xl border border-[var(--mkt-border-light)] p-6"><h3 className="font-bold text-[var(--mkt-primary)]">Información de pago</h3><p className="mt-1 text-xs text-[var(--mkt-muted)]">Verifique los datos antes de continuar.</p>{paymentError ? <InlineAlert className="mt-4" title={paymentError} tone="danger" /> : null}{paymentStatus === "approved" ? <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><strong>✓ Información de pago confirmada</strong><p className="mt-1">Tarjeta {maskedCard}.</p></div> : <div className="mt-5 space-y-5"><FormField id="card-holder" label="Nombre del titular"><Input autoComplete="off" className={inputClass} id="card-holder" onChange={(event) => setHolder(event.target.value)} value={holder} /></FormField><FormField id="card-number" label="Número de tarjeta"><Input autoComplete="off" className={inputClass} id="card-number" inputMode="numeric" maxLength={23} onChange={(event) => { const digits = event.target.value.replace(/\D/g, "").slice(0, 19); setCardNumber(digits.replace(/(.{4})/g, "$1 ").trim()); }} placeholder="4242 4242 4242 4242" value={cardNumber} /></FormField><div className="grid gap-5 sm:grid-cols-2"><FormField id="card-expiry" label="Fecha de vencimiento"><Input autoComplete="off" className={inputClass} id="card-expiry" inputMode="numeric" maxLength={5} onChange={(event) => { const digits = event.target.value.replace(/\D/g, "").slice(0, 4); setExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits); }} placeholder="MM/AA" value={expiry} /></FormField><FormField id="card-cvv" label="CVV"><Input autoComplete="off" className={inputClass} id="card-cvv" inputMode="numeric" maxLength={4} onChange={(event) => setCvv(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="123" type="password" value={cvv} /></FormField></div><button className="w-full rounded-md bg-[var(--mkt-accent)] px-6 py-3 font-semibold text-white hover:bg-[var(--mkt-accent-hover)] disabled:opacity-60" disabled={paymentStatus === "processing"} onClick={simulatePayment} type="button">{paymentStatus === "processing" ? "Validando información..." : `Confirmar información de pago de ${price}`}</button></div>}</div>
                <div><p className="text-xs font-bold uppercase tracking-wide text-[var(--mkt-muted)]">Complementos disponibles posteriormente</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{SUBSCRIPTION_ADDONS.map((addon) => <div className="rounded-lg border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] p-4" key={addon.code}><strong className="text-[var(--mkt-primary)]">{addon.name}</strong><p className="text-sm text-[var(--mkt-muted)]">Q{addon.monthlyQuetzales} / mes</p></div>)}</div></div>
              </div> : null}

              {step === 5 ? <div className="space-y-5"><h2 className="text-xl font-bold text-[var(--mkt-primary)]">Confirme y cree su espacio</h2><div className="grid gap-4 sm:grid-cols-2">{[["Negocio", values.businessName], ["Rubro", presetOptions.find(([value]) => value === businessPreset)?.[1] ?? ""], ["Propietario", `${values.adminName}\n${values.adminEmail}`], ["Entorno", storefrontUrl], ["Plan", `MARJYM Base — ${price}/mes`]].map(([label, value]) => <div className="rounded-xl border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] p-5" key={label}><p className="text-xs font-bold uppercase tracking-wide text-[var(--mkt-muted)]">{label}</p><p className="mt-2 whitespace-pre-line break-all font-semibold text-[var(--mkt-primary)]">{value}</p></div>)}</div><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Información de pago</p><p className="mt-2 font-bold text-emerald-800">✓ Información de pago confirmada</p><p className="mt-1 text-sm text-emerald-800">Tarjeta {maskedCard}.</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-[var(--mkt-muted)]">Disponible para activar después</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{SUBSCRIPTION_ADDONS.map((addon) => <p className="rounded-lg border border-[var(--mkt-border-light)] p-4 text-sm text-[var(--mkt-primary)]" key={addon.code}><strong>{addon.name}</strong><br />Q{addon.monthlyQuetzales} / mes</p>)}</div></div></div> : null}

              <div className="mt-10 flex items-center justify-between border-t border-[var(--mkt-border-light)] pt-6"><button className="rounded-md border border-[var(--mkt-border)] bg-white px-6 py-3 font-semibold text-[var(--mkt-primary)] disabled:opacity-30" disabled={step === 1} onClick={() => { setNotice(undefined); setStep((current) => Math.max(1, current - 1)); }} type="button">Atrás</button>{step < 5 ? <button className="rounded-md bg-[var(--mkt-accent)] px-6 py-3 font-semibold text-white hover:bg-[var(--mkt-accent-hover)] disabled:opacity-50" disabled={step === 4 && paymentStatus !== "approved"} onClick={next} type="button">Continuar</button> : <button className="rounded-md bg-[var(--mkt-accent)] px-6 py-3 font-semibold text-white hover:bg-[var(--mkt-accent-hover)]" type="submit">Confirmar contratación</button>}</div>
            </form>
          )}
        </section>
      </main>
    </>
  );
}
